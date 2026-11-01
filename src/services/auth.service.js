import crypto from 'crypto';

import { User, Session } from '../database/index.js';
import redis from '../databases/redis.js';
import err from '../utils/error.js';
import { comparePassword } from '../utils/password.js';

// Redis Key Strategy: "auth:access:{userId}:{accessToken}"
const REDIS_ACCESS_PREFIX = 'auth:access:';
const REDIS_ACCESS_TTL = 3600; // 1 hour (seconds)

/**
 * @typedef {Object} TokenResult
 * @property {string} accessToken - Access token สำหรับ authentication
 * @property {string} refreshToken - Refresh token สำหรับต่ออายุ session
 * @property {Date} accessTokenExpiresAt - วันที่ access token หมดอายุ
 * @property {Date} refreshTokenExpiresAt - วันที่ refresh token หมดอายุ
 */

/**
 * Service สำหรับจัดการการ authentication และ authorization
 */
class AuthService {
    /**
     * Login - ตรวจสอบ username/password และสร้าง tokens
     * @param {string} username - ชื่อผู้ใช้
     * @param {string} password - รหัสผ่าน
     * @returns {Promise<TokenResult>} Access token และ refresh token
     * @throws {AppError} ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง หรือบัญชีถูกระงับ (unauthorized)
     */
    async login(username, password) {
        // 1. ค้นหา user โดย username
        const user = await User.findOne({
            where: { username },
            attributes: ['id', 'firstName', 'lastName', 'username', 'passwordHash', 'role', 'isActive', 'isDeleted'],
        });

        if (!user) {
            throw err.unauthorized(null, 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
        }

        // 2. ตรวจสอบสถานะ user
        if (!user.isActive || user.isDeleted) {
            throw err.unauthorized(null, 'บัญชีผู้ใช้ถูกระงับหรือถูกลบ');
        }

        // 3. ตรวจสอบ password
        const isPasswordValid = await comparePassword(password, user.passwordHash);
        if (!isPasswordValid) {
            throw err.unauthorized(null, 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
        }

        // 4. สร้าง tokens
        const token = this._generateToken();

        // 5. บันทึก session ลง Database
        await Session.create({
            userId: user.id,
            token: token.accessToken,
            refreshToken: token.refreshToken,
            accessExpiresAt: token.accessTokenExpiresAt,
            refreshExpiresAt: token.refreshTokenExpiresAt,
        });

        // 6. บันทึก access token ลง Redis
        const redisKey = `${REDIS_ACCESS_PREFIX}${user.id}:${token.accessToken}`;
        await redis().setex(redisKey, REDIS_ACCESS_TTL, JSON.stringify({
            userId: user.id,
            username: user.username,
            role: user.role,
            name: `${user.firstName} ${user.lastName}`,
        }));

        // 7. อัปเดต lastLoginAt
        await User.update(
            { lastLoginAt: new Date() },
            { where: { id: user.id } },
        );

        // 8. คืนค่า tokens และ user info
        return {
            accessToken: token.accessToken,
            refreshToken: token.refreshToken,
            accessTokenExpiresAt: token.accessTokenExpiresAt,
            refreshTokenExpiresAt: token.refreshTokenExpiresAt,
        };
    }

    /**
     * Refresh Token - สร้าง access token และ refresh token ใหม่
     * Token Rotation: สร้าง refresh token ใหม่ทุกครั้ง
     * @param {string} refreshToken - Refresh token เดิม
     * @returns {Promise<TokenResult>} Access token และ refresh token ใหม่
     * @throws {AppError} Refresh token ไม่ถูกต้องหรือหมดอายุ หรือบัญชีถูกระงับ (unauthorized)
     */
    async refreshAccessToken(refreshToken) {
        // 1. ค้นหา session จาก refresh token
        const session = await Session.findOne({
            where: { refreshToken },
            include: {
                association: 'user',
                attributes: ['id', 'firstName', 'lastName', 'username', 'role', 'isActive', 'isDeleted'],
            },
        });

        if (!session) {
            throw err.unauthorized(null, 'Refresh token ไม่ถูกต้อง กรุณาล็อกอินใหม่');
        }

        // 2. ตรวจสอบ refresh token expiration
        if (new Date() > session.refreshExpiresAt) {
            // ลบ session ที่หมดอายุ
            await Session.destroy({ where: { id: session.id } });
            throw err.unauthorized(null, 'Refresh token หมดอายุ กรุณาล็อกอินใหม่');
        }

        // 3. ตรวจสอบ user status
        if (!session.user.isActive || session.user.isDeleted) {
            throw err.unauthorized(null, 'บัญชีผู้ใช้ถูกระงับหรือถูกลบ');
        }

        // 4. สร้าง tokens ใหม่ (Token Rotation)
        const token = this._generateToken();

        // 5. อัปเดต session (rotate refresh token)
        await Session.update(
            {
                token: token.accessToken,
                refreshToken: token.refreshToken,
                accessExpiresAt: token.accessTokenExpiresAt, // ไม่ต้องอัพเดท refreshExpiresAt เพราะใช้ของเดิม
            },
            { where: { id: session.id } },
        );

        // 6. บันทึก access token ใหม่ลง Redis
        const redisKey = `${REDIS_ACCESS_PREFIX}${session.user.id}:${token.accessToken}`;
        await redis().setex(redisKey, REDIS_ACCESS_TTL, JSON.stringify({
            userId: session.user.id,
            username: session.user.username,
            role: session.user.role,
            name: `${session.user.firstName} ${session.user.lastName}`,
        }));

        // 7. ลบ access token เก่าออกจาก Redis (ถ้ามี)
        const oldRedisKey = `${REDIS_ACCESS_PREFIX}${session.user.id}:${session.token}`;
        await redis().del(oldRedisKey);

        // 8. คืนค่า tokens ใหม่
        return {
            accessToken: token.accessToken,
            refreshToken: token.refreshToken,
            accessTokenExpiresAt: token.accessTokenExpiresAt,
            refreshTokenExpiresAt: session.refreshExpiresAt, // เป็นวันที่ที่หมดอายุของ refresh token เดิม
        };
    }

    /**
     * Logout - ลบ session และ invalidate tokens
     * @param {string} accessToken - Access token ที่ต้องการ invalidate
     * @returns {Promise<boolean>} สำเร็จจะคืนค่า true
     */
    async logout(accessToken) {
        // 1. ลบ access token ออกจาก Redis (ใช้ key pattern)
        const keys = await redis().keys(`${REDIS_ACCESS_PREFIX}*:${accessToken}`);

        if (keys.length > 0) {
            await redis().del(...keys);
        }

        // 2. ลบ session ออกจาก Database
        await Session.destroy({ where: { token: accessToken } });

        return true;
    }

    /**
     * สร้าง access token และ refresh token ใหม่
     * @private
     * @returns {TokenResult} Token และวันหมดอายุ
     */
    _generateToken() {
        const newAccessTokenExpiresAt = new Date();
        const newRefreshTokenExpiresAt = new Date();

        newAccessTokenExpiresAt.setHours(newAccessTokenExpiresAt.getHours() + 1); // +1 hour
        newRefreshTokenExpiresAt.setDate(newRefreshTokenExpiresAt.getDate() + 7); // +7 days

        return {
            accessToken: crypto.randomBytes(32).toString('hex'),
            refreshToken: crypto.randomBytes(32).toString('hex'),
            accessTokenExpiresAt: newAccessTokenExpiresAt,
            refreshTokenExpiresAt: newRefreshTokenExpiresAt,
        }
    }
}

export default new AuthService();

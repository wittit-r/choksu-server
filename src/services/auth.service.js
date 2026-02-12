import crypto from 'crypto';

import prisma from '../databases/prisma.js';
import redis from '../databases/redis.js';
import err from '../utils/error.js';
import prismaSelectDefault from '../utils/prismaSelectDefault.js';
import { comparePassword } from '../utils/password.js';

// Redis Key Strategy: "auth:access:{userId}:{accessToken}"
const REDIS_ACCESS_PREFIX = 'auth:access:';
const REDIS_ACCESS_TTL = 3600; // 1 hour (seconds)

class AuthService {
    /**
     * Login - ตรวจสอบ username/password และสร้าง tokens
     */
    async login(username, password) {
        // 1. ค้นหา user โดย username
        const user = await prisma.user.findUnique({
            where: { username },
            include: { employee: true }
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
        await prisma.session.create({
            data: {
                userId: user.id,
                token: token.accessToken,
                refreshToken: token.refreshToken,
                accessExpiresAt: token.accessTokenExpiresAt,
                refreshExpiresAt: token.refreshTokenExpiresAt
            }
        });

        // 6. บันทึก access token ลง Redis
        const redisKey = `${REDIS_ACCESS_PREFIX}${user.id}:${token.accessToken}`;
        await redis().setex(redisKey, REDIS_ACCESS_TTL, JSON.stringify({
            userId: user.id,
            username: user.username,
            role: user.role,
            name: user.employee ? `${user.employee.firstName} ${user.employee.lastName}` : null,
            employeeId: user.employeeId,
        }));

        // 7. อัปเดต lastLoginAt
        await prisma.user.update({
            where: { id: user.id },
            data: { lastLoginAt: new Date() }
        });

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
     */
    async refreshAccessToken(refreshToken) {
        // 1. ค้นหา session จาก refresh token
        const session = await prisma.session.findUnique({
            where: { refreshToken: refreshToken },
            include: {
                user: {
                    select: {
                        ...prismaSelectDefault.user,
                        employee: {
                            select: prismaSelectDefault.employee,
                        },
                    }
                }
            }
        });

        if (!session) {
            throw err.unauthorized(null, 'Refresh token ไม่ถูกต้อง กรุณาล็อกอินใหม่');
        }

        // 2. ตรวจสอบ refresh token expiration
        if (new Date() > session.refreshExpiresAt) {
            // ลบ session ที่หมดอายุ
            await prisma.session.delete({ where: { id: session.id } });
            throw err.unauthorized(null, 'Refresh token หมดอายุ กรุณาล็อกอินใหม่');
        }

        // 3. ตรวจสอบ user status
        if (!session.user.isActive || session.user.isDeleted) {
            throw err.unauthorized(null, 'บัญชีผู้ใช้ถูกระงับหรือถูกลบ');
        }

        // 4. สร้าง tokens ใหม่ (Token Rotation)
        const token = this._generateToken();

        // 5. อัปเดต session (rotate refresh token)
        await prisma.session.update({
            where: { id: session.id },
            data: {
                token: token.accessToken,
                refreshToken: token.refreshToken,
                accessExpiresAt: token.accessTokenExpiresAt, // ไม่ต้องอัพเดท refreshExpiresAt เพราะใช้ของเดิม
            }
        });

        // 6. บันทึก access token ใหม่ลง Redis
        const redisKey = `${REDIS_ACCESS_PREFIX}${session.user.id}:${token.accessToken}`;
        await redis().setex(redisKey, REDIS_ACCESS_TTL, JSON.stringify({
            userId: session.user.id,
            username: session.user.username,
            role: session.user.role,
            name: session.user.employee ? `${session.user.employee.firstName} ${session.user.employee.lastName}` : null,
            employeeId: session.user.employeeId,
        }));

        // 7. ลบ access token เก่าออกจาก Redis (ถ้ามี)
        const oldRedisKey = `${REDIS_ACCESS_PREFIX}${session.user.id}:${session.accessToken}`;
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
     */
    async logout(accessToken) {
        // 1. ลบ access token ออกจาก Redis (ใช้ key pattern)
        const keys = await redis().keys(`${REDIS_ACCESS_PREFIX}*:${accessToken}`);

        if (keys.length > 0) {
            await redis().del(...keys);
        }

        // 2. ลบ session ออกจาก Database
        await prisma.session.deleteMany({
            where: { token: accessToken }
        });

        return true;
    }

    /**
     * generate token
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

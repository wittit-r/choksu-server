import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { cleanDatabase, disconnectPrisma } from './helpers/db.js';
import { createTestAuth } from './helpers/auth.js';
import { createApiClient } from './helpers/client.js';
import { Session } from '../src/database/index.js';
import IORedis from 'ioredis';

// Auth flows ตรงๆ (login / me / refresh rotation / expired / logout) — ไม่ต้อง seedTestData
describe('Auth flows: login / me / refresh / logout', () => {
    let redis, api;

    beforeAll(() => {
        redis = new IORedis({ host: 'localhost', port: 6379, maxRetriesPerRequest: null });
    });

    beforeEach(async () => {
        await cleanDatabase();
        const keys = await redis.keys('auth:access:*');
        if (keys.length > 0) await redis.del(...keys);

        const { accessToken } = await createTestAuth();
        api = createApiClient(accessToken);
    });

    afterAll(async () => {
        await redis.quit();
        await disconnectPrisma();
    });

    /** สร้าง user (รหัส test1234) แล้ว login คืน { user, loginRes } */
    async function loginNewUser() {
        const { user } = await createTestAuth();
        const loginRes = await api.login({ username: user.username, password: 'test1234' });
        expect(loginRes.status).toBe(200);
        return { user, loginRes };
    }

    describe('login', () => {
        it('should return 401 with wrong password', async () => {
            const { user } = await createTestAuth();
            const res = await api.login({ username: user.username, password: 'wrong-password' });
            expect(res.status).toBe(401);
            expect(res.body.error.code).toBe('UNAUTHORIZED');
            expect(res.body.error.message).toBe('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
        });

        it('should return 401 when user does not exist', async () => {
            const res = await api.login({ username: 'ghost.user', password: 'whatever123' });
            expect(res.status).toBe(401);
            expect(res.body.error.message).toBe('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
        });

        it('should return tokens, create DB session and redis access key on success', async () => {
            const { user, loginRes } = await loginNewUser();
            const data = loginRes.body.data;

            expect(data.accessToken).toBeDefined();
            expect(data.refreshToken).toBeDefined();
            expect(data.accessTokenExpiresAt).toBeDefined();
            expect(data.refreshTokenExpiresAt).toBeDefined();

            // สร้าง session ใน DB จริง
            const session = await Session.findOne({ where: { token: data.accessToken } });
            expect(session).not.toBeNull();
            expect(session.userId).toBe(user.id);
            expect(session.refreshToken).toBe(data.refreshToken);

            // redis key auth:access:{userId}:{accessToken} มีจริง
            const exists = await redis.exists(`auth:access:${user.id}:${data.accessToken}`);
            expect(exists).toBe(1);
        });
    });

    describe('GET /auth/me', () => {
        it('should return current user info with valid token', async () => {
            const { user, loginRes } = await loginNewUser();
            const accessToken = loginRes.body.data.accessToken;

            const res = await api.raw
                .get('/auth/me')
                .set({ Authorization: `Bearer ${accessToken}` });
            expect(res.status).toBe(200);
            expect(res.body.data.userId).toBe(user.id);
            expect(res.body.data.username).toBe(user.username);
            expect(res.body.data.role).toBe('ACCOUNTING');
            expect(res.body.data.name).toBe(`${user.firstName} ${user.lastName}`);
        });

        it('should return 401 without token', async () => {
            const res = await api.raw.get('/auth/me');
            expect(res.status).toBe(401);
            expect(res.body.error.message).toBe('Authorization header ไม่ถูกต้อง');
        });

        it('should return 401 with a bogus token', async () => {
            const res = await api.raw
                .get('/auth/me')
                .set({ Authorization: 'Bearer totally-fake-token' });
            expect(res.status).toBe(401);
            expect(res.body.error.message).toBe('Token ไม่ถูกต้อง กรุณาล็อกอินใหม่');
        });
    });

    describe('refresh token', () => {
        it('should rotate tokens: old refresh unusable, new access works', async () => {
            const { loginRes } = await loginNewUser();
            const oldAccessToken = loginRes.body.data.accessToken;
            const oldRefreshToken = loginRes.body.data.refreshToken;

            const refreshRes = await api.refresh({ refreshToken: oldRefreshToken });
            expect(refreshRes.status).toBe(200);
            const { accessToken: newAccessToken, refreshToken: newRefreshToken } = refreshRes.body.data;
            expect(newAccessToken).not.toBe(oldAccessToken);
            expect(newRefreshToken).not.toBe(oldRefreshToken);

            // rotation = update session ทับแถวเดิม → refresh token เก่าใช้ซ้ำไม่ได้
            const reuseRes = await api.refresh({ refreshToken: oldRefreshToken });
            expect(reuseRes.status).toBe(401);
            expect(reuseRes.body.error.message).toBe('Refresh token ไม่ถูกต้อง กรุณาล็อกอินใหม่');

            // access ใหม่ใช้ได้กับ /auth/me
            const meRes = await api.raw
                .get('/auth/me')
                .set({ Authorization: `Bearer ${newAccessToken}` });
            expect(meRes.status).toBe(200);

            // access เก่า (token ถูกแทนที่ใน session + redis key เก่าถูกลบ) → 401
            const oldMeRes = await api.raw
                .get('/auth/me')
                .set({ Authorization: `Bearer ${oldAccessToken}` });
            expect(oldMeRes.status).toBe(401);
        });

        it('should reject expired refresh token and delete the session', async () => {
            const { user, loginRes } = await loginNewUser();
            const refreshToken = loginRes.body.data.refreshToken;

            // บังคับให้ refresh token หมดอายุเมื่อวาน
            await Session.update(
                { refreshExpiresAt: new Date(Date.now() - 86400000) },
                { where: { refreshToken } },
            );

            const res = await api.refresh({ refreshToken });
            expect(res.status).toBe(401);
            expect(res.body.error.message).toBe('Refresh token หมดอายุ กรุณาล็อกอินใหม่');

            // session ถูกลบออกจาก DB
            const session = await Session.findOne({
                where: { refreshToken },
            });
            expect(session).toBeNull();

            // (แก้แล้ว) refresh หมดอายุ → ล้าง redis key auth:access:* ของ user ด้วย
            // → access token เดิมตายทันที ไม่ต้องรอ TTL
            const meRes = await api.raw
                .get('/auth/me')
                .set({ Authorization: `Bearer ${loginRes.body.data.accessToken}` });
            expect(meRes.status).toBe(401);
        });
    });

    describe('logout', () => {
        it('should invalidate access token and delete the session', async () => {
            const { loginRes } = await loginNewUser();
            const accessToken = loginRes.body.data.accessToken;

            const logoutRes = await api.logout(accessToken);
            expect(logoutRes.status).toBe(200);
            expect(logoutRes.body.success).toBe(true);

            // access token ใช้ไม่ได้หลัง logout
            const meRes = await api.raw
                .get('/auth/me')
                .set({ Authorization: `Bearer ${accessToken}` });
            expect(meRes.status).toBe(401);

            // session หายจาก DB
            const session = await Session.findOne({ where: { token: accessToken } });
            expect(session).toBeNull();
        });
    });
});

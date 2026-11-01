import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { cleanDatabase, disconnectPrisma } from '../helpers/db.js';
import { createTestAuth } from '../helpers/auth.js';
import { seedTestData } from '../helpers/seed.js';
import { createApiClient } from '../helpers/client.js';
import { Session } from '../../src/database/index.js';
import IORedis from 'ioredis';

// CRUD ของ users + authorize gates (route: /users ใช้ authorize SUPER_ADMIN / SENOIR_ACCOUNTING)
describe('CRUD: users + authorize gates', () => {
    let redis, adminApi, acctApi;

    beforeAll(() => {
        redis = new IORedis({ host: 'localhost', port: 6379, maxRetriesPerRequest: null });
    });

    beforeEach(async () => {
        await cleanDatabase();
        const keys = await redis.keys('auth:access:*');
        if (keys.length > 0) await redis.del(...keys);

        const admin = await createTestAuth('SUPER_ADMIN');
        adminApi = createApiClient(admin.accessToken);
        const acct = await createTestAuth('ACCOUNTING');
        acctApi = createApiClient(acct.accessToken);
        await seedTestData();
    });

    afterAll(async () => {
        await redis.quit();
        await disconnectPrisma();
    });

    /** สร้าง user ใหม่ผ่าน admin API แล้วคืน body.data */
    async function createUserViaApi(overrides = {}) {
        const res = await adminApi.createUser({
            firstName: 'Target',
            lastName: 'User',
            username: `target-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            password: 'target123',
            ...overrides,
        });
        expect(res.status).toBe(201);
        return res.body.data;
    }

    describe('authorize gates', () => {
        it('should return 403 when ACCOUNTING lists users', async () => {
            const res = await acctApi.getUsers();
            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe('FORBIDDEN');
            expect(res.body.error.message).toBe('ไม่มีสิทธิ์เข้าถึง');
        });

        it('should list users with SUPER_ADMIN', async () => {
            const res = await adminApi.getUsers();
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.length).toBeGreaterThanOrEqual(2); // admin + accounting ที่สร้างใน beforeEach
            expect(res.body.pagination).toHaveProperty('total');
        });

        it('should return 403 when ACCOUNTING creates a user (route allows SUPER_ADMIN only)', async () => {
            const res = await acctApi.createUser({
                firstName: 'No',
                lastName: 'Permission',
                username: 'nopermission',
                password: 'nope1234',
            });
            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe('FORBIDDEN');
        });
    });

    describe('create', () => {
        it('should create a user and return 201', async () => {
            const res = await adminApi.createUser({
                firstName: 'Created',
                lastName: 'User',
                username: 'created.user',
                password: 'secret123',
                role: 'COORDINATOR',
            });
            expect(res.status).toBe(201);
            expect(res.body.data.username).toBe('created.user');
            expect(res.body.data.role).toBe('COORDINATOR');
            expect(res.body.data.isActive).toBe(true);

            // FINDING (ล็อก behavior ปัจจุบัน): ตัวเลือก attributes.exclude ของ Sequelize create
            // ไม่มีผลกับ instance ที่คืนมา → response รั่ว passwordHash ออกไปด้วย
            // ควรแก้โดย re-fetch หรือ delete field ก่อนตอบ (security)
            expect(res.body.data.passwordHash).toBeDefined();
        });

        it('should return 409 on duplicate username', async () => {
            await createUserViaApi({ username: 'dup.user' });
            const res = await adminApi.createUser({
                firstName: 'Dup',
                lastName: 'User',
                username: 'dup.user',
                password: 'secret123',
            });
            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe('CONFLICT');
            expect(res.body.error.message).toBe('ชื่อผู้ใช้นี้ถูกใช้งานแล้ว');
        });
    });

    describe('update', () => {
        it('should change user role', async () => {
            const user = await createUserViaApi(); // role default ACCOUNTING
            expect(user.role).toBe('ACCOUNTING');

            const res = await adminApi.updateUser(user.id, { role: 'SENOIR_ACCOUNTING' });
            expect(res.status).toBe(200);
            expect(res.body.data.role).toBe('SENOIR_ACCOUNTING');

            const fetched = await adminApi.getUserById(user.id);
            expect(fetched.body.data.role).toBe('SENOIR_ACCOUNTING');
        });

        it('should invalidate sessions and require new password after password change', async () => {
            const user = await createUserViaApi({ password: 'oldpass123' });

            // login ด้วยรหัสเดิม → ได้ access token
            const loginBefore = await adminApi.login({ username: user.username, password: 'oldpass123' });
            expect(loginBefore.status).toBe(200);
            const oldAccessToken = loginBefore.body.data.accessToken;

            // admin เปลี่ยนรหัสผ่าน
            const res = await adminApi.updateUser(user.id, { password: 'newpass123' });
            expect(res.status).toBe(200);

            // session เดิมถูกลบ (password เปลี่ยน → Session.destroy ทุก session ของ user)
            const sessions = await Session.count({ where: { userId: user.id } });
            expect(sessions).toBe(0);

            // access token เดิมใช้ไม่ได้
            const meRes = await adminApi.raw
                .get('/auth/me')
                .set({ Authorization: `Bearer ${oldAccessToken}` });
            expect(meRes.status).toBe(401);

            // รหัสเก่า login ไม่ได้ / รหัสใหม่ login ได้
            const loginOld = await adminApi.login({ username: user.username, password: 'oldpass123' });
            expect(loginOld.status).toBe(401);
            const loginNew = await adminApi.login({ username: user.username, password: 'newpass123' });
            expect(loginNew.status).toBe(200);
        });

        it('should reject access token after deactivation', async () => {
            const user = await createUserViaApi({ password: 'active123' });

            const login = await adminApi.login({ username: user.username, password: 'active123' });
            expect(login.status).toBe(200);
            const accessToken = login.body.data.accessToken;

            const res = await adminApi.updateUser(user.id, { isActive: false });
            expect(res.status).toBe(200);

            // redis cache ถูกล้าง → ไป DB → user ถูกระงับ → 401
            const meRes = await adminApi.raw
                .get('/auth/me')
                .set({ Authorization: `Bearer ${accessToken}` });
            expect(meRes.status).toBe(401);
            expect(meRes.body.error.message).toBe('บัญชีผู้ใช้ถูกระงับหรือถูกลบ');
        });

        it('should return 404 when updating a missing user', async () => {
            const res = await adminApi.updateUser(9999, { firstName: 'Ghost' });
            expect(res.status).toBe(404);
        });
    });

    describe('getById', () => {
        it('should return 404 when user not found', async () => {
            const res = await adminApi.getUserById(9999);
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe('NOT_FOUND');
        });
    });
});

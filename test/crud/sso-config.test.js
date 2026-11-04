import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { cleanDatabase, disconnectPrisma } from '../helpers/db.js';
import { createTestAuth } from '../helpers/auth.js';
import { createApiClient } from '../helpers/client.js';
import IORedis from 'ioredis';

// CRUD: sso_configs — เงื่อนไขประกันสังคมตามช่วงเวลา
// กติกาหลัก: ห้ามช่วงเวลาทับกัน / แก้-ลบแถวเก่าได้เสมอ (payroll ใช้ snapshot)
describe('CRUD: sso-configs', () => {
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

    const BASE = { ratePercent: 5, maxWage: 17500 };

    it('should list empty configs', async () => {
        const res = await api.getSsoConfigs();
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toEqual([]);
    });

    it('should create a config and return 201 with shape', async () => {
        const res = await api.createSsoConfig({ effectiveFrom: '2026-01-01', effectiveTo: '2028-12-31', ...BASE });
        expect(res.status).toBe(201);
        expect(res.body.data.id).toBeDefined();
        expect(res.body.data.ratePercent).toBe(5);
        expect(res.body.data.maxWage).toBe(17500);
    });

    it('should create config with effectiveTo null (ใช้ตลอดไป)', async () => {
        const res = await api.createSsoConfig({ effectiveFrom: '2032-01-01', effectiveTo: null, ...BASE });
        expect(res.status).toBe(201);
        expect(res.body.data.effectiveTo).toBeNull();
    });

    describe('overlap validation (ห้ามช่วงทับ)', () => {
        beforeEach(async () => {
            // แถวฐาน: 2026-01-01 → 2028-12-31
            await api.createSsoConfig({ effectiveFrom: '2026-01-01', effectiveTo: '2028-12-31', ...BASE });
        });

        it('should reject แทรกกลางช่วง', async () => {
            const res = await api.createSsoConfig({ effectiveFrom: '2027-01-01', effectiveTo: '2027-12-31', ...BASE });
            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe('CONFLICT');
        });

        it('should reject ทับหัวช่วง (คร่อมวันเริ่ม)', async () => {
            const res = await api.createSsoConfig({ effectiveFrom: '2025-06-01', effectiveTo: '2026-06-30', ...BASE });
            expect(res.status).toBe(409);
        });

        it('should reject ทับท้ายช่วง (คร่อมวันสิ้นสุด)', async () => {
            const res = await api.createSsoConfig({ effectiveFrom: '2028-06-01', effectiveTo: '2029-06-30', ...BASE });
            expect(res.status).toBe(409);
        });

        it('should reject ครอบทั้งช่วง (unbounded)', async () => {
            const res = await api.createSsoConfig({ effectiveFrom: '2020-01-01', effectiveTo: null, ...BASE });
            expect(res.status).toBe(409);
        });

        it('should allow ช่วงก่อนหน้า/ถัดไปที่ชิดขอบ (ไม่ทับ)', async () => {
            const before = await api.createSsoConfig({ effectiveFrom: '2024-01-01', effectiveTo: '2025-12-31', ...BASE });
            const after = await api.createSsoConfig({ effectiveFrom: '2029-01-01', effectiveTo: null, ...BASE });
            expect(before.status).toBe(201);
            expect(after.status).toBe(201);

            const list = await api.getSsoConfigs();
            expect(list.body.data).toHaveLength(3);
            // เรียงตาม effectiveFrom อัตโนมัติ
            expect(list.body.data.map((c) => c.maxWage)).toEqual([17500, 17500, 17500]);
        });

        it('should reject ช่วงใหม่ชนแถว unbounded (แถวเดิม null = ตลอดไป)', async () => {
            await api.createSsoConfig({ effectiveFrom: '2032-01-01', effectiveTo: null, ...BASE });
            const res = await api.createSsoConfig({ effectiveFrom: '2040-01-01', effectiveTo: '2041-12-31', ...BASE });
            expect(res.status).toBe(409);
        });
    });

    it('should reject effectiveTo ก่อน effectiveFrom (422)', async () => {
        const res = await api.createSsoConfig({ effectiveFrom: '2026-06-01', effectiveTo: '2026-01-01', ...BASE });
        expect(res.status).toBe(422);
    });

    describe('update', () => {
        it('should update บาง field โดยไม่ชนตัวเอง', async () => {
            const created = await api.createSsoConfig({ effectiveFrom: '2026-01-01', effectiveTo: '2028-12-31', ...BASE });
            const res = await api.updateSsoConfig(created.body.data.id, { maxWage: 20000 });
            expect(res.status).toBe(200);
            expect(res.body.data.maxWage).toBe(20000);
            // ช่วงเวลาเดิมถูกเก็บไว้
            expect(res.body.data.effectiveTo).toBeTruthy();
        });

        it('should reject แก้ช่วงแล้วไปชนแถวอื่น', async () => {
            const a = await api.createSsoConfig({ effectiveFrom: '2020-01-01', effectiveTo: '2024-12-31', ...BASE });
            const b = await api.createSsoConfig({ effectiveFrom: '2026-01-01', effectiveTo: '2028-12-31', ...BASE });

            // ย้ายวันเริ่มของ B ไปทับ A
            const res = await api.updateSsoConfig(b.body.data.id, { effectiveFrom: '2023-01-01' });
            expect(res.status).toBe(409);
        });

        it('should reject body ว่าง (422)', async () => {
            const created = await api.createSsoConfig({ effectiveFrom: '2026-01-01', effectiveTo: '2028-12-31', ...BASE });
            const res = await api.updateSsoConfig(created.body.data.id, {});
            expect(res.status).toBe(422);
        });
    });

    describe('delete', () => {
        it('should delete config ได้แม้มี payroll อ้าง snapshot ไปแล้ว (ไม่บล็อก)', async () => {
            const created = await api.createSsoConfig({ effectiveFrom: '2026-01-01', effectiveTo: '2028-12-31', ...BASE });
            const res = await api.deleteSsoConfig(created.body.data.id);
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);

            const list = await api.getSsoConfigs();
            expect(list.body.data).toHaveLength(0);
        });

        it('should 404 เมื่อลบแถวที่ไม่มี', async () => {
            const res = await api.deleteSsoConfig(999);
            expect(res.status).toBe(404);
        });
    });
});

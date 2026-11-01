import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { cleanDatabase, disconnectPrisma } from '../helpers/db.js';
import { createTestAuth } from '../helpers/auth.js';
import { seedTestData } from '../helpers/seed.js';
import { createApiClient } from '../helpers/client.js';
import IORedis from 'ioredis';

describe('Flow 6: Force close — ต้องปิดรอบทันทีแม้ข้อมูลยังไม่ครบ', () => {
    let redis, api, seed;

    beforeAll(() => {
        redis = new IORedis({ host: 'localhost', port: 6379, maxRetriesPerRequest: null });
    });

    beforeEach(async () => {
        await cleanDatabase();
        const keys = await redis.keys('auth:access:*');
        if (keys.length > 0) await redis.del(...keys);

        const { accessToken } = await createTestAuth();
        api = createApiClient(accessToken);
        seed = await seedTestData();
    });

    afterAll(async () => {
        await redis.quit();
        await disconnectPrisma();
    });

    it('should reject close when PENDING payrolls exist without force', async () => {
        const periodRes = await api.createPayPeriod({
            periodNo: 1,
            year: 2025,
            employeeType: 'WORKER',
            startDate: '2025-06-01',
            endDate: '2025-06-15',
        });
        const periodId = periodRes.body.data.id;

        const sheetRes = await api.createWorkerTimeSheet({
            workLeaderId: seed.workLeader.id,
            workDate: '2025-06-02',
            pattern: { regular: true, ot: 0 },
            entries: seed.employees.slice(0, 3).map(emp => ({
                employeeId: emp.id,
                timeIn: '08:00:00',
                timeOut: '17:00:00',
                shiftType: 'REGULAR',
            })),
        });
        await api.updateTimeSheet(sheetRes.body.data.id, { status: 'FILLED' });

        await api.createPayrolls(periodId);

        // พยายามปิดรอบโดยไม่ export → ต้อง error
        const closeRes = await api.closePeriod(periodId, false);
        expect(closeRes.status).toBe(400);
        expect(closeRes.body.error.message).toContain('ยังไม่ได้ export');
    });

    it('should close period with force=true even when PENDING payrolls exist', async () => {
        const periodRes = await api.createPayPeriod({
            periodNo: 1,
            year: 2025,
            employeeType: 'WORKER',
            startDate: '2025-06-01',
            endDate: '2025-06-15',
        });
        const periodId = periodRes.body.data.id;

        const sheetRes = await api.createWorkerTimeSheet({
            workLeaderId: seed.workLeader.id,
            workDate: '2025-06-02',
            pattern: { regular: true, ot: 0 },
            entries: seed.employees.slice(0, 3).map(emp => ({
                employeeId: emp.id,
                timeIn: '08:00:00',
                timeOut: '17:00:00',
                shiftType: 'REGULAR',
            })),
        });
        await api.updateTimeSheet(sheetRes.body.data.id, { status: 'FILLED' });

        await api.createPayrolls(periodId);

        // ปิดรอบด้วย force=true
        const closeRes = await api.closePeriod(periodId, true);
        expect(closeRes.status).toBe(200);
        expect(closeRes.body.message).toContain('ถูกข้าม');

        // ตรวจสอบรอบจ่าย CLOSED
        const period = await api.getPayPeriodById(periodId);
        expect(period.body.data.status).toBe('CLOSED');

        // ตรวจสอบ payroll ยังคง PENDING (ไม่เปลี่ยน)
        const payrolls = await api.getPayrolls({ payPeriodId: periodId, limit: 10 });
        for (const p of payrolls.body.data) {
            expect(p.status).toBe('PENDING');
        }
    });

    it('should close normally after export (no force needed)', async () => {
        const periodRes = await api.createPayPeriod({
            periodNo: 1,
            year: 2025,
            employeeType: 'WORKER',
            startDate: '2025-06-01',
            endDate: '2025-06-15',
        });
        const periodId = periodRes.body.data.id;

        const sheetRes = await api.createWorkerTimeSheet({
            workLeaderId: seed.workLeader.id,
            workDate: '2025-06-02',
            pattern: { regular: true, ot: 0 },
            entries: seed.employees.slice(0, 3).map(emp => ({
                employeeId: emp.id,
                timeIn: '08:00:00',
                timeOut: '17:00:00',
                shiftType: 'REGULAR',
            })),
        });
        await api.updateTimeSheet(sheetRes.body.data.id, { status: 'FILLED' });

        await api.createPayrolls(periodId);
        await api.exportPeriod(periodId);

        // ปิดรอบปกติ — ไม่ต้อง force
        const closeRes = await api.closePeriod(periodId, false);
        expect(closeRes.status).toBe(200);

        const period = await api.getPayPeriodById(periodId);
        expect(period.body.data.status).toBe('CLOSED');
    });
});

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { cleanDatabase, disconnectPrisma } from '../helpers/db.js';
import { createTestAuth } from '../helpers/auth.js';
import { seedTestData } from '../helpers/seed.js';
import { createApiClient } from '../helpers/client.js';
import IORedis from 'ioredis';

describe('Flow 1: Happy Path — จ่ายเงินปกติทุกคน', () => {
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

    it('should complete full payroll cycle: create period → fill entries → create payrolls → export → close', async () => {
        // Step 1: สร้างรอบจ่าย (OPEN)
        const periodRes = await api.createPayPeriod({
            periodNo: 1,
            year: 2025,
            employeeType: 'WORKER',
            startDate: '2025-06-01',
            endDate: '2025-06-15',
        });
        expect(periodRes.status).toBe(201);
        expect(periodRes.body.success).toBe(true);
        expect(periodRes.body.data.status).toBe('OPEN');
        const periodId = periodRes.body.data.id;

        // Step 2: สร้าง timesheet ใบเซ็นชื่อ (DAILY) พร้อม time entry 3 คน
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
        expect(sheetRes.status).toBe(201);
        const sheetId = sheetRes.body.data.id;

        // Step 3: ทำเครื่องหมาย timesheet เป็น FILLED
        const fillRes = await api.updateTimeSheet(sheetId, { status: 'FILLED' });
        expect(fillRes.status).toBe(200);
        expect(fillRes.body.data.status).toBe('FILLED');

        // Step 4: สร้าง payroll ทั้งหมด
        const payrollRes = await api.createPayrolls(periodId);
        expect(payrollRes.status).toBe(201);
        expect(payrollRes.body.created).toBe(3);
        expect(payrollRes.body.payrolls.length).toBe(3);
        expect(payrollRes.body.payrolls[0].status).toBe('PENDING');

        // Step 5: Export (PENDING → CALCULATED) — ตอนนี้คืนไฟล์ xlsx แนบ (ไม่ใช่ JSON)
        const exportRes = await api.exportPeriod(periodId);
        expect(exportRes.status).toBe(200);
        expect(exportRes.headers['content-type']).toContain('spreadsheetml');

        // Step 6: ตรวจสอบ payroll ทั้งหมดเป็น CALCULATED
        const payrollsRes = await api.getPayrolls({ payPeriodId: periodId, limit: 10 });
        expect(payrollsRes.status).toBe(200);
        for (const p of payrollsRes.body.data) {
            expect(p.status).toBe('CALCULATED');
        }

        // Step 7: ปิดรอบ (OPEN → CLOSED)
        const closeRes = await api.closePeriod(periodId);
        expect(closeRes.status).toBe(200);

        // Step 8: ตรวจสอบสถานะรอบจ่ายเป็น CLOSED
        const period = await api.getPayPeriodById(periodId);
        expect(period.body.data.status).toBe('CLOSED');
    });
});

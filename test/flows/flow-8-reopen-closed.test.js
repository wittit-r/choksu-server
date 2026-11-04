import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { cleanDatabase, disconnectPrisma } from '../helpers/db.js';
import { createTestAuth } from '../helpers/auth.js';
import { seedTestData } from '../helpers/seed.js';
import { createApiClient } from '../helpers/client.js';
import IORedis from 'ioredis';

describe('Flow 8: ปิดรอบไปแล้ว ต้องเพิ่มคนเพิ่ม', () => {
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

    it('should reopen closed period, add new employee payroll, and close again', async () => {
        // Step 1: สร้างรอบจ่าย + timesheet + payroll + export + close (เหมือน Flow 1)
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

        const payrollRes = await api.createPayrolls(periodId);
        expect(payrollRes.body.created).toBe(3);

        // export = finalize ปิดรอบให้เอง (ไม่ต้อง close ซ้ำ)
        await api.exportPeriod(periodId);

        // ตรวจสอบ CLOSED
        const periodCheck = await api.getPayPeriodById(periodId);
        expect(periodCheck.body.data.status).toBe('CLOSED');

        // Step 2: เพิ่มเวลาให้พนักงานใหม่ (คนที่ 4 และ 5)
        const sheet2Res = await api.createWorkerTimeSheet({
            workLeaderId: seed.workLeader.id,
            workDate: '2025-06-03',
            pattern: { regular: true, ot: 0 },
            entries: seed.employees.slice(3, 5).map(emp => ({
                employeeId: emp.id,
                timeIn: '08:00:00',
                timeOut: '17:00:00',
                shiftType: 'REGULAR',
            })),
        });
        await api.updateTimeSheet(sheet2Res.body.data.id, { status: 'FILLED' });

        // Step 3: Reopen รอบจ่าย
        const reopenRes = await api.reopenPeriod(periodId);
        expect(reopenRes.status).toBe(200);
        expect(reopenRes.body.data.status).toBe('OPEN');

        // Step 4: สร้าง payroll ให้คนใหม่
        const newPayrollRes = await api.createPayrolls(periodId);
        expect(newPayrollRes.status).toBe(201);
        expect(newPayrollRes.body.created).toBe(2);

        // Step 5: Export payroll ใหม่ = ปิดรอบใหม่ให้เอง
        const exportRes = await api.exportPeriod(periodId);
        expect(exportRes.status).toBe(200);

        // Step 6: ปิดซ้ำด้วยมือ → 400 (export ปิดไปแล้ว)
        const closeRes = await api.closePeriod(periodId);
        expect(closeRes.status).toBe(400);
        expect((await api.getPayPeriodById(periodId)).body.data.status).toBe('CLOSED');

        // Step 7: ตรวจสอบ payroll เดิมยังคง CALCULATED
        const oldPayrollIds = payrollRes.body.payrolls.map(p => p.id);
        for (const id of oldPayrollIds) {
            const p = await api.getPayrollById(id);
            expect(p.body.data.status).toBe('CALCULATED');
        }

        // Step 8: ตรวจสอบ payroll ใหม่เป็น CALCULATED
        const newPayrollIds = newPayrollRes.body.payrolls.map(p => p.id);
        for (const id of newPayrollIds) {
            const p = await api.getPayrollById(id);
            expect(p.body.data.status).toBe('CALCULATED');
        }

        // Step 9: ตรวจสอบรวม payroll ทั้งหมด 5 รายการ
        const allPayrolls = await api.getPayrolls({ payPeriodId: periodId, limit: 10 });
        expect(allPayrolls.body.pagination.total).toBe(5);
    });
});

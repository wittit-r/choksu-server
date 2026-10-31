import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { cleanDatabase, disconnectPrisma } from '../helpers/db.js';
import { createTestAuth } from '../helpers/auth.js';
import { seedTestData } from '../helpers/seed.js';
import { createApiClient } from '../helpers/client.js';
import IORedis from 'ioredis';

describe('Flow 2: ข้อมูลยังไม่ครบ — สร้าง payroll ทีละส่วน', () => {
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

    it('should create payrolls for some employees first, then add more later', async () => {
        // Step 1: สร้างรอบจ่าย
        const periodRes = await api.createPayPeriod({
            periodNo: 1,
            year: 2025,
            employeeType: 'WORKER',
            startDate: '2025-06-01',
            endDate: '2025-06-15',
        });
        expect(periodRes.status).toBe(201);
        const periodId = periodRes.body.data.id;

        // Step 2: สร้าง timesheet และกรอกเวลาเฉพาะ 3 คน
        const sheet1Res = await api.createWorkerTimeSheet({
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
        expect(sheet1Res.status).toBe(201);
        await api.updateTimeSheet(sheet1Res.body.data.id, { status: 'FILLED' });

        // Step 3: สร้าง payroll — ควรได้ 3 คน
        const payroll1Res = await api.createPayrolls(periodId);
        expect(payroll1Res.status).toBe(201);
        expect(payroll1Res.body.created).toBe(3);
        expect(payroll1Res.body.skipped).toBe(0);

        // Step 4: เพิ่มเวลาให้อีก 2 คน
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
        expect(sheet2Res.status).toBe(201);
        await api.updateTimeSheet(sheet2Res.body.data.id, { status: 'FILLED' });

        // Step 5: สร้าง payroll อีกรอบ — ควรได้เพิ่ม 2 คน
        const payroll2Res = await api.createPayrolls(periodId);
        expect(payroll2Res.status).toBe(201);
        expect(payroll2Res.body.created).toBe(2);

        // Step 6: สร้าง payroll อีกรอบ — ไม่ควรได้เพิ่มเลย (ทุกคนมี payroll แล้ว)
        const payroll3Res = await api.createPayrolls(periodId);
        expect(payroll3Res.status).toBe(201);
        expect(payroll3Res.body.created).toBe(0);

        // Step 7: ตรวจสอบว่ามี payroll ทั้งหมด 5 รายการ
        const allPayrolls = await api.getPayrolls({ payPeriodId: periodId, limit: 10 });
        expect(allPayrolls.body.pagination.total).toBe(5);
    });

    it('should create payroll for a specific employee only', async () => {
        const periodRes = await api.createPayPeriod({
            periodNo: 1,
            year: 2025,
            employeeType: 'WORKER',
            startDate: '2025-06-01',
            endDate: '2025-06-15',
        });
        const periodId = periodRes.body.data.id;

        // สร้าง timesheet ให้ทุกคน
        const sheetRes = await api.createWorkerTimeSheet({
            workLeaderId: seed.workLeader.id,
            workDate: '2025-06-02',
            pattern: { regular: true, ot: 0 },
            entries: seed.employees.map(emp => ({
                employeeId: emp.id,
                timeIn: '08:00:00',
                timeOut: '17:00:00',
                shiftType: 'REGULAR',
            })),
        });
        await api.updateTimeSheet(sheetRes.body.data.id, { status: 'FILLED' });

        // สร้าง payroll เฉพาะ 1 คน
        const payrollRes = await api.createPayrolls(periodId, {
            employeeId: seed.employees[0].id,
        });
        expect(payrollRes.status).toBe(201);
        expect(payrollRes.body.created).toBe(1);
        expect(payrollRes.body.payrolls[0].employeeId).toBe(seed.employees[0].id);
    });
});

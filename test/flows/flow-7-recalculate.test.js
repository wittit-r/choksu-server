import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { cleanDatabase, disconnectPrisma } from '../helpers/db.js';
import { createTestAuth } from '../helpers/auth.js';
import { seedTestData } from '../helpers/seed.js';
import { createApiClient } from '../helpers/client.js';
import IORedis from 'ioredis';

describe('Flow 7: Recalculate — มี time entry เพิ่มเข้ามาหลังสร้าง payroll', () => {
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

    it('should recalculate payroll after adding new time entry via correction', async () => {
        // Step 1: สร้างรอบจ่าย + timesheet + payroll ให้ 3 คน
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
        const sheetId = sheetRes.body.data.id;
        await api.updateTimeSheet(sheetId, { status: 'FILLED' });

        const payrollRes = await api.createPayrolls(periodId);
        expect(payrollRes.body.created).toBe(3);

        const payrollId = payrollRes.body.payrolls[0].id;
        const employeeId = seed.employees[0].id;

        // Step 2: เพิ่ม time entry ใหม่ (correction/negative) ในช่วงเวลาเดียวกัน
        // สร้าง timesheet ใหม่เพื่อเพิ่ม entry
        const sheet2Res = await api.createWorkerTimeSheet({
            workLeaderId: seed.workLeader.id,
            workDate: '2025-06-03',
            pattern: { regular: true, ot: 0 },
            entries: seed.employees.slice(0, 1).map(emp => ({
                employeeId: emp.id,
                timeIn: '08:00:00',
                timeOut: '17:00:00',
                shiftType: 'REGULAR',
            })),
        });
        expect(sheet2Res.status).toBe(201);
        const sheet2Id = sheet2Res.body.data.id;
        await api.updateTimeSheet(sheet2Id, { status: 'FILLED' });

        // Step 3: Recalculate payroll ระดับเดี่ยว
        const recalcRes = await api.recalculatePayroll(payrollId);
        expect(recalcRes.status).toBe(200);
        expect(recalcRes.body.data.newEntries).toBeGreaterThanOrEqual(1);

        // Step 4: ตรวจสอบว่า recalculate สำเร็จ
        const updatedPayroll = await api.getPayrollById(payrollId);
        expect(updatedPayroll.status).toBe(200);
    });

    it('should recalculate all payrolls in a period', async () => {
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

        // เพิ่ม timesheet ใหม่ให้ทุกคน
        const sheet2Res = await api.createWorkerTimeSheet({
            workLeaderId: seed.workLeader.id,
            workDate: '2025-06-03',
            pattern: { regular: true, ot: 0 },
            entries: seed.employees.slice(0, 3).map(emp => ({
                employeeId: emp.id,
                timeIn: '08:00:00',
                timeOut: '17:00:00',
                shiftType: 'REGULAR',
            })),
        });
        await api.updateTimeSheet(sheet2Res.body.data.id, { status: 'FILLED' });

        // Recalculate ทั้งรอบ
        const recalcRes = await api.recalculatePeriod(periodId);
        expect(recalcRes.status).toBe(200);
        expect(recalcRes.body.updated).toBe(3);
    });
});

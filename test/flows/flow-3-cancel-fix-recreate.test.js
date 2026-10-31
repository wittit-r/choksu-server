import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { cleanDatabase, disconnectPrisma } from '../helpers/db.js';
import { createTestAuth } from '../helpers/auth.js';
import { seedTestData } from '../helpers/seed.js';
import { createApiClient } from '../helpers/client.js';
import IORedis from 'ioredis';

describe('Flow 3: สร้าง payroll แล้ว เจอข้อมูลพนักงานผิด — ยกเลิก แก้ สร้างใหม่', () => {
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

    it('should cancel payroll, fix time entry, and recreate payroll', async () => {
        // Step 1: สร้างรอบจ่าย + timesheet + payroll
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

        // Step 2: ยกเลิก payroll ของคนแรก
        const payrollId = payrollRes.body.payrolls[0].id;
        const cancelRes = await api.cancelPayroll(payrollId);
        expect(cancelRes.status).toBe(200);

        // Step 3: ตรวจสอบ payroll ถูกยกเลิก
        const payrollCheck = await api.getPayrollById(payrollId);
        expect(payrollCheck.body.data.status).toBe('CANCELLED');

        // Step 4: ตรวจสอบ time entry กลับเป็น DRAFT
        const sheetCheck = await api.getTimesheetById(sheetId);
        const targetEmployeeId = seed.employees[0].id;
        const entriesForEmployee = sheetCheck.body.data.timeEntries.filter(
            e => e.employeeId === targetEmployeeId,
        );
        for (const entry of entriesForEmployee) {
            expect(entry.status).toBe('DRAFT');
            expect(entry.paidValue).toBeNull();
        }

        // Step 5: แก้ไข time entry — ต้องเปลี่ยน timesheet เป็น PENDING ก่อน
        await api.updateTimeSheet(sheetId, { status: 'PENDING' });
        const entryToFix = entriesForEmployee[0];
        const fixRes = await api.updateWorkerTimeEntry(sheetId, entryToFix.id, {
            timeIn: '08:00:00',
            timeOut: '17:00:00',
            shiftType: 'REGULAR',
        });
        expect(fixRes.status).toBe(200);

        // Step 6: เปลี่ยน timesheet กลับเป็น FILLED แล้วสร้าง payroll ใหม่
        await api.updateTimeSheet(sheetId, { status: 'FILLED' });
        const recreateRes = await api.createPayrolls(periodId, {
            employeeId: targetEmployeeId,
        });
        expect(recreateRes.status).toBe(201);
        expect(recreateRes.body.created).toBe(1);

        // Step 7: ตรวจสอบ time entry กลับเป็น LOCKED
        const sheetAfterRecreate = await api.getTimesheetById(sheetId);
        const entriesAfterFix = sheetAfterRecreate.body.data.timeEntries.filter(
            e => e.employeeId === targetEmployeeId,
        );
        for (const entry of entriesAfterFix) {
            expect(entry.status).toBe('LOCKED');
            expect(entry.paidValue).not.toBeNull();
        }
    });
});

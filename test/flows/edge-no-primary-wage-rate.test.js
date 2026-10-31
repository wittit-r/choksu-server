import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { cleanDatabase, disconnectPrisma } from '../helpers/db.js';
import { createTestAuth } from '../helpers/auth.js';
import { seedTestData } from '../helpers/seed.js';
import { createApiClient } from '../helpers/client.js';
import prisma from '../../src/databases/prisma.js';
import IORedis from 'ioredis';

// Regression: GET /pay-periods/:id เคย crash (TypeError → 500) เมื่อพนักงานมี payroll
// แต่ไม่มี WageRate ที่ effective ณ วันเริ่มรอบ (เช่น rate เริ่มหลังวันเริ่มรอบ)
describe('Edge: พนักงานไม่มี WageRate ณ วันเริ่มรอบ', () => {
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

    it('should return 200 with null positionCode and dailyRate 0 (not 500)', async () => {
        // ทำให้พนักงานคนที่ 5 มี rate เริ่มหลังวันเริ่มรอบ (06-02 > period start 06-01)
        await prisma.wageRate.updateMany({
            where: { employeeId: seed.employees[4].id },
            data: { effectiveFrom: new Date('2025-06-02') },
        });

        // สร้างรอบจ่าย 01-15 มิ.ย. + ลงเวลาทุกคนวันที่ 02 (วันที่ rate ของคนที่ 5 มีผลแล้ว)
        const periodRes = await api.createPayPeriod({
            periodNo: 1,
            year: 2025,
            employeeType: 'WORKER',
            startDate: '2025-06-01',
            endDate: '2025-06-15',
        });
        expect(periodRes.status).toBe(201);
        const periodId = periodRes.body.data.id;

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
        expect(sheetRes.status).toBe(201);
        await api.updateTimeSheet(sheetRes.body.data.id, { status: 'FILLED' });

        // พนักงานทุกคน (รวมคนที่ 5) ต้องได้ payroll — filter ใช้ effectiveFrom <= endDate
        const payrollRes = await api.createPayrolls(periodId);
        expect(payrollRes.status).toBe(201);
        expect(payrollRes.body.created).toBe(5);

        // จุดที่เคย crash: ต้องได้ 200 + fallback ที่ถูกต้อง
        const detailRes = await api.getPayPeriodById(periodId);
        expect(detailRes.status).toBe(200);

        const target = detailRes.body.data.payrolls
            .find(p => p.employeeId === seed.employees[4].id);
        expect(target.employee.positionCode).toBeNull();
        expect(target.employee.positionName).toBeNull();
        expect(target.summary.dailyRate).toBe(0);
        // ยอดอื่นๆ ยังคำนวณได้ปกติ (entry วันที่ 02 มี rate ครอบคลุม)
        expect(Number(target.summary.regularAmount)).toBeGreaterThan(0);

        // พนักงานปกติยังได้ตำแหน่งตาม wage rate
        const normal = detailRes.body.data.payrolls
            .find(p => p.employeeId === seed.employees[0].id);
        expect(normal.employee.positionCode).toBe(seed.workerPosition.code);
        expect(normal.summary.dailyRate).toBe(500);
    });
});

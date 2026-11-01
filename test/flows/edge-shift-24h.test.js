import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { cleanDatabase, disconnectPrisma } from '../helpers/db.js';
import { createTestAuth } from '../helpers/auth.js';
import { seedTestData } from '../helpers/seed.js';
import { createApiClient } from '../helpers/client.js';
import { TimeEntry } from '../../src/database/index.js';
import IORedis from 'ioredis';

// กะตาม model ของระบบ: ดึก 00:00-08:00 / เช้า 08:00-16:00 / บ่าย 16:00-24:00
// (24:00 = เที่ยงคืนวันถัดไป ตาม combineDateAndTime) — ต้องคิดค่าจ้างเต็ม 500/กะ ไม่ติดลบ
describe('Edge: กะ (SHIFT) รวมถึงช่วง 24:00', () => {
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

    it('กะดึก 00:00-08:00 และกะบ่าย 16:00-24:00 ต้องได้ค่าจ้างเต็มวันละกะ', async () => {
        const periodRes = await api.createPayPeriod({
            periodNo: 1,
            year: 2026,
            employeeType: 'WORKER',
            startDate: '2026-11-01',
            endDate: '2026-11-15',
        });
        expect(periodRes.status).toBe(201);
        const periodId = periodRes.body.data.id;

        // คนที่ 1 กะดึก / คนที่ 2 กะบ่าย (ใช้ 24:00)
        const sheetRes = await api.createWorkerTimeSheet({
            workLeaderId: seed.workLeader.id,
            workDate: '2026-11-02',
            pattern: { regular: true, ot: 0 },
            entries: [
                {
                    employeeId: seed.employees[0].id,
                    timeIn: '00:00:00',
                    timeOut: '08:00:00',
                    shiftType: 'SHIFT',
                },
                {
                    employeeId: seed.employees[1].id,
                    timeIn: '16:00:00',
                    timeOut: '24:00:00',
                    shiftType: 'SHIFT',
                },
            ],
        });
        expect(sheetRes.status).toBe(201);
        await api.updateTimeSheet(sheetRes.body.data.id, { status: 'FILLED' });

        const payrollRes = await api.createPayrolls(periodId);
        expect(payrollRes.status).toBe(201);
        expect(payrollRes.body.created).toBe(2);

        const detailRes = await api.getPayPeriodById(periodId);
        expect(detailRes.status).toBe(200);
        const payrolls = detailRes.body.data.payrolls;

        for (const p of payrolls) {
            expect(p.summary.regularAmount).toBe(500);
            expect(p.summary.workingDays).toBe(1);
            expect(p.summary.netPay).toBe(500);
        }
    });

    it('ข้อมูลที่ถูกแก้ตรงๆ ใน DB จน end < start (เช่น 22:00→06:00) ต้องไม่ได้ค่าจ้างติดลบ', async () => {
        const periodRes = await api.createPayPeriod({
            periodNo: 1,
            year: 2026,
            employeeType: 'WORKER',
            startDate: '2026-11-01',
            endDate: '2026-11-15',
        });
        const periodId = periodRes.body.data.id;

        const sheetRes = await api.createWorkerTimeSheet({
            workLeaderId: seed.workLeader.id,
            workDate: '2026-11-02',
            pattern: { regular: true, ot: 0 },
            entries: [{
                employeeId: seed.employees[0].id,
                timeIn: '08:00:00',
                timeOut: '16:00:00',
                shiftType: 'SHIFT',
            }],
        });
        expect(sheetRes.status).toBe(201);
        await api.updateTimeSheet(sheetRes.body.data.id, { status: 'FILLED' });
        await api.createPayrolls(periodId);

        // จำลอง "แก้ DB ตรงๆ" เป็นกะข้ามวัน 22:00 → 06:00 (digits วันเดียวกัน → ติดลบ)
        await TimeEntry.update(
            {
                startTime: new Date('2026-11-02T22:00:00Z'),
                endTime: new Date('2026-11-02T06:00:00Z'),
            },
            { where: { employeeId: seed.employees[0].id } },
        );

        const recalcRes = await api.recalculatePeriod(periodId);
        expect(recalcRes.status).toBe(200);

        const detailRes = await api.getPayPeriodById(periodId);
        const p = detailRes.body.data.payrolls[0];
        // 8 ชม. → ค่าจ้างเต็มวัน ไม่ติดลบ
        expect(p.summary.regularAmount).toBe(500);
        expect(p.summary.workingDays).toBe(1);
        expect(p.summary.netPay).toBe(500);
    });
});

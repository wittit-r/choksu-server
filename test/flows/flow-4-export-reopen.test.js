import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { cleanDatabase, disconnectPrisma } from '../helpers/db.js';
import { createTestAuth } from '../helpers/auth.js';
import { seedTestData } from '../helpers/seed.js';
import { createApiClient } from '../helpers/client.js';
import IORedis from 'ioredis';

// Flow 4 จาก src/routes/flows.md: "Export แล้ว ต้องเพิ่มพนักงานใหม่"
//   export แล้ว → payroll ทั้งหมด CALCULATED
//     → กรอกเวลาเพิ่มให้พนักงานใหม่ → TimeSheet: FILLED, TimeEntry: DRAFT
//     → PATCH /pay-periods/:id/reopen → period: CLOSED → OPEN (payroll เดิมยัง CALCULATED)
//     → POST /pay-periods/:id/payrolls { employeeId } → payroll ใหม่ PENDING
//     → POST /pay-periods/:id/export → เฉพาะ PENDING ใหม่ → CALCULATED (ของเก่าไม่เปลี่ยน)
//     → PATCH /pay-periods/:id/close → CLOSED
//
// ข้อสังเกตจากโค้ดจริง (pay-period.service.js):
//   exportPayPeriod ไม่เปลี่ยนสถานะ period (ค้าง OPEN) ต่างจากผัง Status Flow ใน flows.md
//   ที่เขียน `OPEN ──export──▶ CLOSED` และ Flow 4 ไม่มี step close ก่อน reopen
//   → reopen ตอน period ยัง OPEN จะโดน 400 ('รอบจ่ายไม่อยู่ในสถานะปิด')
//   test นี้ล็อก behavior นั้นไว้ แล้ว close → reopen ให้ถึงสถานะที่ Flow 4 ตั้งใจ
describe('Flow 4: Export แล้ว ต้องเพิ่มพนักงานใหม่', () => {
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

    // ลงเวลาวันเต็ม 1 คน (08:00–17:00 REGULAR → 480 effective → paidValue 500) + FILLED
    async function fillDay(emp, workDate) {
        const res = await api.createWorkerTimeSheet({
            workLeaderId: seed.workLeader.id,
            workDate,
            pattern: { regular: true, ot: 0 },
            entries: [{ employeeId: emp.id, timeIn: '08:00:00', timeOut: '17:00:00', shiftType: 'REGULAR' }],
        });
        expect(res.status).toBe(201);
        const fill = await api.updateTimeSheet(res.body.data.id, { status: 'FILLED' });
        expect(fill.status).toBe(200);
        return res.body.data;
    }

    it('export → เพิ่มคนใหม่ → reopen → payroll ใหม่ → export รอบสอง → close', async () => {
        // Step 1: สร้างรอบจ่าย (OPEN)
        const periodRes = await api.createPayPeriod({
            periodNo: 1,
            year: 2025,
            employeeType: 'WORKER',
            startDate: '2025-06-01',
            endDate: '2025-06-15',
        });
        expect(periodRes.status).toBe(201);
        const periodId = periodRes.body.data.id;

        // Step 2: ลงเวลาคนแรก + สร้าง payroll 1 คน → PENDING
        const sheet1 = await fillDay(seed.employees[0], '2025-06-02');
        const createRes = await api.createPayrolls(periodId);
        expect(createRes.status).toBe(201);
        expect(createRes.body.created).toBe(1);
        const firstPayroll = createRes.body.payrolls[0];
        expect(firstPayroll.status).toBe('PENDING');

        // Step 3: export → payroll คนแรก PENDING → CALCULATED (period ยัง OPEN)
        const export1 = await api.exportPeriod(periodId);
        expect(export1.status).toBe(200);
        expect(export1.body.data.updatedCount).toBe(1);

        const afterExport = await api.getPayPeriodById(periodId);
        expect(afterExport.body.data.status).toBe('OPEN'); // export ไม่ปิดรอบ
        const exported = afterExport.body.data.payrolls.find(
            (p) => p.id === firstPayroll.id,
        );
        expect(exported.status).toBe('CALCULATED');
        expect(exported.payRef).toBe(firstPayroll.payRef);

        // Step 4: กรอกเวลาเพิ่มให้คนที่สอง → FILLED, entry DRAFT
        const sheet2 = await fillDay(seed.employees[1], '2025-06-03');
        const sheet2Detail = await api.getTimesheetById(sheet2.id);
        expect(sheet2Detail.body.data.timeEntries[0].status).toBe('DRAFT');

        // Step 5a: reopen ตาม Flow 4 → จริงคือ 400 เพราะ period ยัง OPEN
        const reopenTooEarly = await api.reopenPeriod(periodId);
        expect(reopenTooEarly.status).toBe(400);
        expect(reopenTooEarly.body.error.message).toContain('ไม่อยู่ในสถานะปิด');

        // Step 5b: close (ไม่มี PENDING ค้าง → ปิดได้) แล้ว reopen → OPEN ตามเป้า Flow 4
        const closeRes = await api.closePeriod(periodId);
        expect(closeRes.status).toBe(200);
        expect((await api.getPayPeriodById(periodId)).body.data.status).toBe('CLOSED');

        const reopenRes = await api.reopenPeriod(periodId);
        expect(reopenRes.status).toBe(200);
        expect(reopenRes.body.data.status).toBe('OPEN');

        // payroll เดิมยังคง CALCULATED หลัง reopen
        const afterReopen = await api.getPayPeriodById(periodId);
        expect(afterReopen.body.data.payrolls).toHaveLength(1);
        expect(afterReopen.body.data.payrolls[0].status).toBe('CALCULATED');

        // Step 6: สร้าง payroll คนใหม่ → PENDING (คนเก่าไม่ถูกสร้างซ้ำ)
        const createRes2 = await api.createPayrolls(periodId, {
            employeeId: seed.employees[1].id,
        });
        expect(createRes2.status).toBe(201);
        expect(createRes2.body.created).toBe(1);
        expect(createRes2.body.payrolls[0].employeeId).toBe(seed.employees[1].id);
        expect(createRes2.body.payrolls[0].status).toBe('PENDING');

        // Step 7: export รอบสอง → เฉพาะ PENDING ใหม่ → CALCULATED
        const export2 = await api.exportPeriod(periodId);
        expect(export2.status).toBe(200);
        expect(export2.body.data.updatedCount).toBe(1);

        // Step 8: ปิดรอบ
        const closeRes2 = await api.closePeriod(periodId);
        expect(closeRes2.status).toBe(200);

        // ตรวจสถานะทุกตัว: period CLOSED, payroll 2 ตัว CALCULATED,
        // ตัวเก่า id/payRef ไม่เปลี่ยน, time entries ทั้งสอง sheet LOCKED พร้อม paidValue
        const final = await api.getPayPeriodById(periodId);
        expect(final.body.data.status).toBe('CLOSED');
        expect(final.body.data.payrolls).toHaveLength(2);

        const oldPayroll = final.body.data.payrolls.find((p) => p.id === firstPayroll.id);
        expect(oldPayroll).toBeDefined();
        expect(oldPayroll.status).toBe('CALCULATED');
        expect(oldPayroll.payRef).toBe(firstPayroll.payRef);
        expect(oldPayroll.employeeId).toBe(seed.employees[0].id);

        const newPayroll = final.body.data.payrolls.find((p) => p.id === createRes2.body.payrolls[0].id);
        expect(newPayroll).toBeDefined();
        expect(newPayroll.status).toBe('CALCULATED');
        expect(newPayroll.employeeId).toBe(seed.employees[1].id);

        for (const sheet of [sheet1, sheet2]) {
            const detail = await api.getTimesheetById(sheet.id);
            for (const entry of detail.body.data.timeEntries) {
                expect(entry.status).toBe('LOCKED');
                expect(Number(entry.paidValue)).toBe(500); // วันเต็ม 480 effective → dailyRate
            }
        }
    });
});

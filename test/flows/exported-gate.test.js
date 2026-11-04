import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { cleanDatabase, disconnectPrisma } from '../helpers/db.js';
import { createTestAuth } from '../helpers/auth.js';
import { seedTestData } from '../helpers/seed.js';
import { createApiClient } from '../helpers/client.js';
import IORedis from 'ioredis';

// กติกาตาม docs/PAYROLL-EXPORT-LOCK-PLAN.md
// - export = finalize: PENDING → CALCULATED + รอบ OPEN → CLOSED ใน transaction เดียว
// - รอบ CLOSED = ห้าม mutate ทุก action (400) ต้อง reopen ก่อน
// - payroll CALCULATED (export ไปแล้ว) = 409 จนกว่าส่ง allowExported: true
// - import ไฟล์ธนาคารทำได้เฉพาะรอบ CLOSED
describe('Export lock + allowExported gate', () => {
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

    // สร้างรอบ + ลงเวลา 2 คน + สร้างยอดจ่าย 2 รายการ (PENDING, รอบ OPEN)
    async function setupPeriodWithPayrolls() {
        const periodRes = await api.createPayPeriod({
            periodNo: 1,
            year: 2026,
            employeeType: 'WORKER',
            startDate: '2026-10-01',
            endDate: '2026-10-15',
        });
        expect(periodRes.status).toBe(201);
        const periodId = periodRes.body.data.id;

        await fillDay(seed.employees[0], '2026-10-02');
        await fillDay(seed.employees[1], '2026-10-03');
        const createRes = await api.createPayrolls(periodId);
        expect(createRes.status).toBe(201);
        expect(createRes.body.created).toBe(2);

        return { periodId, payrolls: createRes.body.payrolls };
    }

    it('export = finalize: payroll CALCULATED + รอบ CLOSED พร้อมกัน', async () => {
        const { periodId, payrolls } = await setupPeriodWithPayrolls();

        const exportRes = await api.exportPeriod(periodId);
        expect(exportRes.status).toBe(200);

        const after = (await api.getPayPeriodById(periodId)).body.data;
        expect(after.status).toBe('CLOSED');
        expect(after.payrolls).toHaveLength(2);
        for (const p of after.payrolls) {
            expect(p.status).toBe('CALCULATED');
        }
        // payRef เดิมไม่เปลี่ยน
        expect(after.payrolls.map((p) => p.payRef).sort())
            .toEqual(payrolls.map((p) => p.payRef).sort());
    });

    it('รอบ CLOSED: mutate ทุก action ต้องได้ 400 (ไม่มี override)', async () => {
        const { periodId, payrolls } = await setupPeriodWithPayrolls();
        await api.exportPeriod(periodId);
        expect((await api.getPayPeriodById(periodId)).body.data.status).toBe('CLOSED');

        // แม้จะส่ง allowExported ก็ทะลุไม่ได้ — CLOSED ล็อคก่อน gate เสมอ
        const [recalcOne, recalcAll, update, cancelOne, cancelAll] = await Promise.all([
            api.recalculatePayroll(payrolls[0].id, { allowExported: true }),
            api.recalculatePeriod(periodId, { allowExported: true }),
            api.updatePayroll(payrolls[0].id, { ssoAmount: 100, allowExported: true }),
            api.cancelPayroll(payrolls[0].id, { allowExported: true }),
            api.cancelAllPayrolls(periodId, { allowExported: true }),
        ]);

        for (const res of [recalcOne, recalcAll, update, cancelOne, cancelAll]) {
            expect(res.status).toBe(400);
            expect(res.body.error.message).toContain('ปิด');
        }

        // สร้างยอดเพิ่มในรอบปิดก็ไม่ได้ (ของเดิม)
        const createMore = await api.createPayrolls(periodId);
        expect(createMore.status).toBe(400);
    });

    it('reopen แล้ว CALCULATED: 409 พร้อม payRef/exportedPayrolls → allowExported ผ่านทุก action', async () => {
        const { periodId, payrolls } = await setupPeriodWithPayrolls();
        await api.exportPeriod(periodId);
        await api.reopenPeriod(periodId);
        expect((await api.getPayPeriodById(periodId)).body.data.status).toBe('OPEN');

        const [p1, p2] = payrolls;

        // แก้การหัก: 409 รายคน → retry ผ่าน
        const edit1 = await api.updatePayroll(p1.id, { ssoAmount: 100 });
        expect(edit1.status).toBe(409);
        expect(edit1.body.error.details.payRef).toBe(p1.payRef);
        const edit2 = await api.updatePayroll(p1.id, { ssoAmount: 100, allowExported: true });
        expect(edit2.status).toBe(200);

        // คำนวณใหม่รายคน: 409 → retry ผ่าน
        const recalc1 = await api.recalculatePayroll(p1.id);
        expect(recalc1.status).toBe(409);
        expect(recalc1.body.error.details.payRef).toBe(p1.payRef);
        const recalc2 = await api.recalculatePayroll(p1.id, { allowExported: true });
        expect(recalc2.status).toBe(200);

        // คำนวณใหม่ทั้งรอบ: 409 พร้อมรายการ exportedPayrolls ครบ 2 แถว → retry ผ่าน
        const recalcAll1 = await api.recalculatePeriod(periodId);
        expect(recalcAll1.status).toBe(409);
        expect(recalcAll1.body.error.details.exportedPayrolls.sort())
            .toEqual([p1.payRef, p2.payRef].sort());
        const recalcAll2 = await api.recalculatePeriod(periodId, { allowExported: true });
        expect(recalcAll2.status).toBe(200);

        // ยกเลิกรายคน: 409 → retry ผ่าน (คืน entry เป็น DRAFT ตามกติกาเดิม)
        const cancel1 = await api.cancelPayroll(p1.id);
        expect(cancel1.status).toBe(409);
        expect(cancel1.body.error.details.payRef).toBe(p1.payRef);
        const cancel2 = await api.cancelPayroll(p1.id, { allowExported: true });
        expect(cancel2.status).toBe(200);

        // ยกเลิกทั้งรอบ: เหลือ p2 CALCULATED → 409 แถวเดียว → retry ผ่าน
        const cancelAll1 = await api.cancelAllPayrolls(periodId);
        expect(cancelAll1.status).toBe(409);
        expect(cancelAll1.body.error.details.exportedPayrolls).toEqual([p2.payRef]);
        const cancelAll2 = await api.cancelAllPayrolls(periodId, { allowExported: true });
        expect(cancelAll2.status).toBe(200);

        const after = (await api.getPayPeriodById(periodId)).body.data;
        expect(after.status).toBe('OPEN');
        for (const p of after.payrolls) {
            expect(p.status).toBe('CANCELLED');
        }
    });

    it('PENDING ยังไม่ export: แก้ได้ทุก action ไม่ต้อง flag (regression)', async () => {
        const { periodId, payrolls } = await setupPeriodWithPayrolls();

        const edit = await api.updatePayroll(payrolls[0].id, { ssoAmount: 100 });
        expect(edit.status).toBe(200);

        const recalcOne = await api.recalculatePayroll(payrolls[0].id);
        expect(recalcOne.status).toBe(200);

        const recalcAll = await api.recalculatePeriod(periodId);
        expect(recalcAll.status).toBe(200);

        const cancelAll = await api.cancelAllPayrolls(periodId);
        expect(cancelAll.status).toBe(200);
        expect((await api.getPayPeriodById(periodId)).body.data.status).toBe('OPEN');
    });

    it('import ไฟล์ธนาคาร: ได้เฉพาะรอบ CLOSED (ยังเป็น TODO stub)', async () => {
        const { periodId } = await setupPeriodWithPayrolls();

        // รอบยัง OPEN → 400
        const openRes = await api.importPeriod(periodId);
        expect(openRes.status).toBe(400);
        expect(openRes.body.error.message).toContain('ปิดแล้ว');

        // export ปิดรอบ → import ผ่าน guard (ยังเป็น TODO)
        await api.exportPeriod(periodId);
        const closedRes = await api.importPeriod(periodId);
        expect(closedRes.status).toBe(200);
        expect(closedRes.body.message).toContain('TODO');
    });
});

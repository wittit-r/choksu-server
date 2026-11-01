import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { cleanDatabase, disconnectPrisma } from '../helpers/db.js';
import { createTestAuth } from '../helpers/auth.js';
import { seedTestData } from '../helpers/seed.js';
import { createApiClient } from '../helpers/client.js';
import IORedis from 'ioredis';

// ล็อกสูตรเงินทุกกรณี — ค่าแรงจาก seedTestData: dailyRate 500, hourlyRate 62.5, minuteRate 1.042
//
// สูตรอ่านจาก src/services/pay-period.service.js (_calculateEntryAmount + _buildPayrollSummary):
//   REGULAR       : totalMinutes = endTime − startTime
//                   ถ้า shiftType = REGULAR และมี endTime → หักช่วงทับ 12:00-13:00 (720-780 นาที)
//                   effectiveMinutes >= 480 → dailyRate
//                   effectiveMinutes <  480 → floor(ชม.)×hourlyRate + นาทีเศษ×minuteRate
//   OVERTIME      : ไม่หักพัก, otMultiplier = otRate
//                   totalMinutes >= 480 → dailyRate × otMultiplier
//                   totalMinutes <  480 → (floor(ชม.)×hourlyRate + นาทีเศษ×minuteRate) × otMultiplier
//   ACCOMMODATION : paidValue = entry.accommodation (ค่าตรงๆ)
//   netPay        = round((regular + ot + accommodation + retro − deduction − sso − slf − other)×100)/100
//
// หมายเหตุสำคัญ (อ่านจาก timesheet.service.js createWorkerTimeSheet):
//   pattern { regular, ot } ถูก map เป็น entry "เดียว" ต่อคน
//   workType = pattern.regular ? 'REGULAR' : 'OVERTIME', otRate = pattern.ot
//   → จะได้ entry OVERTIME ต้องใช้ pattern.regular = false
describe('Money Formulas — ล็อกสูตรคำนวณเงินทุกกรณี', () => {
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

    // สร้างรอบจ่าย WORKER 1–15 มิ.ย. 2025 (ค่าแรง seed effective 2025-01-01 ครอบทั้งรอบ)
    async function createPeriod() {
        const res = await api.createPayPeriod({
            periodNo: 1,
            year: 2025,
            employeeType: 'WORKER',
            startDate: '2025-06-01',
            endDate: '2025-06-15',
        });
        expect(res.status).toBe(201);
        return res.body.data.id;
    }

    // สร้าง worker sheet + เปลี่ยนสถานะเป็น FILLED
    async function fillWorkerSheet({ workDate, pattern, entries, allowDuplicate = false }) {
        const res = await api.createWorkerTimeSheet({
            workLeaderId: seed.workLeader.id,
            workDate,
            allowDuplicate,
            pattern,
            entries,
        });
        expect(res.status).toBe(201);
        const fill = await api.updateTimeSheet(res.body.data.id, { status: 'FILLED' });
        expect(fill.status).toBe(200);
        return res.body.data;
    }

    async function getFirstPayroll(periodId) {
        const res = await api.getPayPeriodById(periodId);
        expect(res.status).toBe(200);
        return res.body.data.payrolls[0];
    }

    it('OT คูณ 1.5: วันเดียวมีทั้ง REGULAR และ OVERTIME entry', async () => {
        const periodId = await createPeriod();
        const emp = seed.employees[0];

        // REGULAR 08:00–17:00 (shiftType REGULAR):
        //   totalMinutes = 540, หักพัก 12:00–13:00 ทับเต็ม 60 นาที → effective = 480
        //   480 >= 480 → dailyRate = 500
        await fillWorkerSheet({
            workDate: '2025-06-02',
            pattern: { regular: true, ot: 0 },
            entries: [{ employeeId: emp.id, timeIn: '08:00:00', timeOut: '17:00:00', shiftType: 'REGULAR' }],
        });

        // OVERTIME 17:00–18:30 ด้วย pattern { regular: false, ot: 1.5 } → workType OVERTIME, otRate 1.5
        //   (สอง sheet ต้อง allowDuplicate — ห้าม OT ทับเวลา REGULAR จึงเริ่ม 17:00 พอดี)
        //   totalMinutes = 90 (< 480, ไม่หักพัก) → (1×62.5 + 30×1.042) × 1.5 = 93.76 × 1.5 = 140.64
        await fillWorkerSheet({
            workDate: '2025-06-02',
            allowDuplicate: true,
            pattern: { regular: false, ot: 1.5 },
            entries: [{ employeeId: emp.id, timeIn: '17:00:00', timeOut: '18:30:00', shiftType: 'REGULAR' }],
        });

        const createRes = await api.createPayrolls(periodId);
        expect(createRes.status).toBe(201);
        expect(createRes.body.created).toBe(1);

        const payroll = await getFirstPayroll(periodId);
        expect(payroll.summary.regularAmount).toBeCloseTo(500, 2);
        expect(payroll.summary.otAmount).toBeCloseTo(140.64, 2);
        expect(payroll.summary.netPay).toBeCloseTo(640.64, 2); // 500 + 140.64
        expect(payroll.summary.overtimeMinutes['1.5']).toBe(90);
    });

    it('OT คูณ 2 และ 3: OT-only ไม่มีงานปกติ', async () => {
        const periodId = await createPeriod();

        // คนที่ 1 — OVERTIME 17:00–19:00, otRate 2:
        //   totalMinutes = 120 < 480 → (2×62.5 + 0×1.042) × 2 = 125 × 2 = 250.00
        await fillWorkerSheet({
            workDate: '2025-06-02',
            pattern: { regular: false, ot: 2 },
            entries: [{ employeeId: seed.employees[0].id, timeIn: '17:00:00', timeOut: '19:00:00', shiftType: 'REGULAR' }],
        });

        // คนที่ 2 — OVERTIME 17:00–18:00, otRate 3:
        //   totalMinutes = 60 < 480 → (1×62.5 + 0×1.042) × 3 = 62.5 × 3 = 187.50
        await fillWorkerSheet({
            workDate: '2025-06-03',
            pattern: { regular: false, ot: 3 },
            entries: [{ employeeId: seed.employees[1].id, timeIn: '17:00:00', timeOut: '18:00:00', shiftType: 'REGULAR' }],
        });

        const createRes = await api.createPayrolls(periodId);
        expect(createRes.status).toBe(201);
        expect(createRes.body.created).toBe(2);

        const detail = await api.getPayPeriodById(periodId);
        const byEmployee = new Map(detail.body.data.payrolls.map((p) => [p.employeeId, p]));

        const p0 = byEmployee.get(seed.employees[0].id);
        expect(p0.summary.otAmount).toBeCloseTo(250, 2);
        expect(p0.summary.netPay).toBeCloseTo(250, 2);
        expect(p0.summary.overtimeMinutes['2']).toBe(120);

        const p1 = byEmployee.get(seed.employees[1].id);
        expect(p1.summary.otAmount).toBeCloseTo(187.5, 2);
        expect(p1.summary.netPay).toBeCloseTo(187.5, 2);
        expect(p1.summary.overtimeMinutes['3']).toBe(60);
    });

    it('วันไม่เต็ม: 09:00–17:00 REGULAR → ได้ค่าแรงรายนาที 437.50 ไม่ใช่ dailyRate 500', async () => {
        const periodId = await createPeriod();
        const emp = seed.employees[0];

        // totalMinutes = 480, หักพัก 12:00–13:00 ทับเต็ม 60 นาที → effective = 420
        // 420 < 480 → 7×62.5 + 0×1.042 = 437.50
        await fillWorkerSheet({
            workDate: '2025-06-02',
            pattern: { regular: true, ot: 0 },
            entries: [{ employeeId: emp.id, timeIn: '09:00:00', timeOut: '17:00:00', shiftType: 'REGULAR' }],
        });

        const createRes = await api.createPayrolls(periodId);
        expect(createRes.status).toBe(201);
        expect(createRes.body.created).toBe(1);

        const payroll = await getFirstPayroll(periodId);
        expect(payroll.summary.regularAmount).toBeCloseTo(437.5, 2);
        expect(payroll.summary.netPay).toBeCloseTo(437.5, 2);
        expect(payroll.summary.workingDays).toBe(0.875); // 420/480
    });

    it('ครึ่งวัน: 08:00–12:00 → ไม่ถูกหักพักกลางวัน → 4×62.5 = 250', async () => {
        const periodId = await createPeriod();
        const emp = seed.employees[0];

        // totalMinutes = 240; overlap พัก = [max(480,720)=720, min(720,780)=720) → ไม่ทับ → ไม่หัก
        // 240 < 480 → 4×62.5 + 0×1.042 = 250
        await fillWorkerSheet({
            workDate: '2025-06-02',
            pattern: { regular: true, ot: 0 },
            entries: [{ employeeId: emp.id, timeIn: '08:00:00', timeOut: '12:00:00', shiftType: 'REGULAR' }],
        });

        const createRes = await api.createPayrolls(periodId);
        expect(createRes.status).toBe(201);
        expect(createRes.body.created).toBe(1);

        const payroll = await getFirstPayroll(periodId);
        expect(payroll.summary.regularAmount).toBeCloseTo(250, 2);
        expect(payroll.summary.netPay).toBeCloseTo(250, 2);
        expect(payroll.summary.workingDays).toBe(0.5); // 240/480
    });

    it('แก้ deduction (SSO/SLF/other) ผ่าน PATCH /payrolls/:id → บันทึกและ netPay ลดตาม', async () => {
        const periodId = await createPeriod();
        const emp = seed.employees[0];

        // วันเต็ม 08:00–17:00 → 500 (เหมือน Flow 1)
        await fillWorkerSheet({
            workDate: '2025-06-02',
            pattern: { regular: true, ot: 0 },
            entries: [{ employeeId: emp.id, timeIn: '08:00:00', timeOut: '17:00:00', shiftType: 'REGULAR' }],
        });
        const createRes = await api.createPayrolls(periodId);
        expect(createRes.status).toBe(201);
        const payrollId = createRes.body.payrolls[0].id;

        const before = await getFirstPayroll(periodId);
        expect(before.summary.netPay).toBeCloseTo(500, 2);

        // แก้ deduction รวม 85
        const updateRes = await api.updatePayroll(payrollId, {
            ssoAmount: 50,
            slfAmount: 25,
            otherDeduction: 10,
        });
        expect(updateRes.status).toBe(200);

        const after = await getFirstPayroll(periodId);
        expect(after.ssoAmount).toBe(50);
        expect(after.slfAmount).toBe(25);
        expect(after.otherDeduction).toBe(10);
        expect(after.summary.regularAmount).toBeCloseTo(500, 2); // ค่าแรงไม่เปลี่ยน
        expect(after.summary.netPay).toBeCloseTo(415, 2); // 500 − (50+25+10)
    });

    it('netPay รวมทุกส่วน: regular + OT + accommodation − SSO', async () => {
        const periodId = await createPeriod();
        const emp = seed.employees[0];

        // (1) REGULAR 08:00–17:00 → 480 effective → dailyRate 500
        await fillWorkerSheet({
            workDate: '2025-06-02',
            pattern: { regular: true, ot: 0 },
            entries: [{ employeeId: emp.id, timeIn: '08:00:00', timeOut: '17:00:00', shiftType: 'REGULAR' }],
        });

        // (2) OVERTIME 17:00–18:30 otRate 1.5 → (62.5 + 31.26) × 1.5 = 140.64
        await fillWorkerSheet({
            workDate: '2025-06-03',
            pattern: { regular: false, ot: 1.5 },
            entries: [{ employeeId: emp.id, timeIn: '17:00:00', timeOut: '18:30:00', shiftType: 'REGULAR' }],
        });

        // (3) ACCOMMODATION 300 — worker endpoint ไม่มี workType ACCOMMODATION
        //     จึงใช้ driver monthly sheet กับพนักงานคนเดียวกัน (API อนุญาต)
        const accSheetRes = await api.createDriverTimeSheet({
            employeeId: emp.id,
            monthPeriod: '2025-06',
            entries: [{ date: '2025-06-04', timeIn: null, timeOut: null, workType: 'ACCOMMODATION', otRate: 0, accommodation: 300 }],
        });
        expect(accSheetRes.status).toBe(201);
        expect(await api.updateTimeSheet(accSheetRes.body.data.id, { status: 'FILLED' })).toHaveProperty('status', 200);

        const createRes = await api.createPayrolls(periodId);
        expect(createRes.status).toBe(201);
        expect(createRes.body.created).toBe(1);
        const payrollId = createRes.body.payrolls[0].id;

        // ก่อนแก้ deduction: netPay = 500 + 140.64 + 300 = 940.64
        const before = await getFirstPayroll(periodId);
        expect(before.summary.regularAmount).toBeCloseTo(500, 2);
        expect(before.summary.otAmount).toBeCloseTo(140.64, 2);
        expect(before.summary.accommodationAmount).toBe(300);
        expect(before.summary.netPay).toBeCloseTo(940.64, 2);

        // แก้ SSO 750 → netPay = 940.64 − 750 = 190.64
        const updateRes = await api.updatePayroll(payrollId, { ssoAmount: 750 });
        expect(updateRes.status).toBe(200);

        const after = await getFirstPayroll(periodId);
        expect(after.ssoAmount).toBe(750);
        expect(after.summary.netPay).toBeCloseTo(190.64, 2);
    });

    // POTENTIAL BUG (ล็อก behavior ปัจจุบันไว้กันกำกวม):
    // createWorkerTimeSheet ไม่ได้สร้าง OVERTIME entry ให้อัตโนมัติเมื่อ pattern = { regular: true, ot: 1.5 }
    // และไม่ reject combo นี้ (Joi รับ ot ทุกค่าไม่ดู regular) — entry เดียว workType REGULAR + otRate 1.5
    // ถูกเก็บลง DB แต่ _calculateEntryAmount สาย REGULAR ไม่ใช้ otRate → OT หายเงียบๆ
    // เทียบ: driver endpoint (validateWorkTypeRules) reject REGULAR+otRate>0 ด้วย 422
    // ถ้าซ่อมเป็น reject ค่อยอัปเดต test นี้เป็น 422
    it('behavior ปัจจุบัน: pattern { regular: true, ot: 1.5 } → entry REGULAR เดี่ยว OT ถูกเพิกเฉย', async () => {
        const periodId = await createPeriod();
        const emp = seed.employees[0];

        const sheetRes = await api.createWorkerTimeSheet({
            workLeaderId: seed.workLeader.id,
            workDate: '2025-06-02',
            pattern: { regular: true, ot: 1.5 },
            entries: [{ employeeId: emp.id, timeIn: '08:00:00', timeOut: '17:00:00', shiftType: 'REGULAR' }],
        });
        expect(sheetRes.status).toBe(201);
        expect(sheetRes.body.data.timeEntries).toHaveLength(1);

        const entry = sheetRes.body.data.timeEntries[0];
        expect(entry.workType).toBe('REGULAR');
        expect(entry.otRate).toBe(1.5); // เก็บ rate ไว้แต่คำนวณไม่ใช้

        await api.updateTimeSheet(sheetRes.body.data.id, { status: 'FILLED' });
        const createRes = await api.createPayrolls(periodId);
        expect(createRes.status).toBe(201);
        expect(createRes.body.created).toBe(1);

        // REGULAR 08:00–17:00 → 480 effective → 500 / ไม่มี OT เลย
        const payroll = await getFirstPayroll(periodId);
        expect(payroll.summary.regularAmount).toBeCloseTo(500, 2);
        expect(payroll.summary.otAmount).toBe(0);
        expect(payroll.summary.overtimeMinutes['1.5']).toBe(0);
        expect(payroll.summary.netPay).toBeCloseTo(500, 2);
    });
});

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { cleanDatabase, disconnectPrisma } from '../helpers/db.js';
import { createTestAuth } from '../helpers/auth.js';
import { seedTestData } from '../helpers/seed.js';
import { createApiClient } from '../helpers/client.js';
import { Employee, WageRate, Position } from '../../src/database/index.js';
import IORedis from 'ioredis';

// ฟีเจอร์ SSO: หักประกันสังคมอัตโนมัติตอนสร้าง/recalculate ยอดจ่าย (docs/SSO-PLAN.md)
// สูตร: base = regularAmount − correction (clamp 0) / sso = min(ปัดสปส(rate×base), cap − ยอดสะสมรอบก่อนในเดือน)
// ตัวเลข golden ชุด A/B/C มาจากตัวอย่างจริงของผู้ใช้ (cap 875 = 5% × 17,500)
describe('SSO — หักประกันสังคมอัตโนมัติใน payroll', () => {
    let redis, api, seed, user;

    beforeAll(() => {
        redis = new IORedis({ host: 'localhost', port: 6379, maxRetriesPerRequest: null });
    });

    beforeEach(async () => {
        await cleanDatabase();
        const keys = await redis.keys('auth:access:*');
        if (keys.length > 0) await redis.del(...keys);

        const auth = await createTestAuth();
        user = auth.user;
        api = createApiClient(auth.accessToken);
        seed = await seedTestData();

        await api.createLeaveType({ name: 'ลาป่วย', defaultDaysPerYear: 30 });
        await api.generateEntitlements({ year: 2025 });
        await api.generateEntitlements({ year: 2026 });
    });

    afterAll(async () => {
        await redis.quit();
        await disconnectPrisma();
    });

    // ─── helpers ────────────────────────────────────────
    const seedConfig = async (maxWage = 17500, effectiveFrom = '2020-01-01', effectiveTo = null) => {
        const res = await api.createSsoConfig({ effectiveFrom, effectiveTo, ratePercent: 5, maxWage });
        expect(res.status).toBe(201);
        return res.body.data;
    };

    const setDailyRate = async (employeeId, dailyRate) => {
        await WageRate.update({ dailyRate }, { where: { employeeId } });
    };

    async function fillSheet(employees, workDate, pattern = { regular: true, ot: 0 }) {
        const res = await api.createWorkerTimeSheet({
            workLeaderId: seed.workLeader.id,
            workDate,
            pattern,
            entries: employees.map((emp) => ({
                employeeId: emp.id,
                timeIn: '08:00:00',
                timeOut: '17:00:00',
                shiftType: 'REGULAR',
            })),
        });
        expect(res.status).toBe(201);
        const fill = await api.updateTimeSheet(res.body.data.id, { status: 'FILLED' });
        expect(fill.status).toBe(200);
    }

    const juneDays = (from, to) => {
        const days = [];
        for (let d = from; d <= to; d++) days.push(`2025-06-${String(d).padStart(2, '0')}`);
        return days;
    };

    async function createWorkerPeriod(periodNo, startDate, endDate) {
        const res = await api.createPayPeriod({
            periodNo, year: Number(startDate.slice(0, 4)), employeeType: 'WORKER', startDate, endDate,
        });
        expect(res.status).toBe(201);
        return res.body.data;
    }

    async function payrollOf(periodId, employeeId) {
        const detail = await api.getPayPeriodById(periodId);
        expect(detail.status).toBe(200);
        return detail.body.data.payrolls.find((p) => p.employeeId === employeeId);
    }

    // ─── ชุด golden A/B/C (ตารางบังคับจากผู้ใช้) ────────
    it('worker A/B/C — สะสมเพดานข้าม 2 รอบในเดือนเดียว (cap 875)', async () => {
        await seedConfig(17500);
        const [a, b, c] = seed.employees;
        await setDailyRate(a.id, 500);
        await setDailyRate(b.id, 700);
        await setDailyRate(c.id, 1300);

        // ครึ่งเดือนแรก: 1–14 มิ.ย. (14 วัน)
        const p1 = await createWorkerPeriod(1, '2025-06-01', '2025-06-14');
        for (const d of juneDays(1, 14)) await fillSheet([a, b, c], d);
        let res = await api.createPayrolls(p1.id);
        expect(res.status).toBe(201);

        let pa = await payrollOf(p1.id, a.id);
        let pb = await payrollOf(p1.id, b.id);
        let pc = await payrollOf(p1.id, c.id);
        expect(pa.ssoAmount).toBe(350);          // 7,000 × 5%
        expect(pa.ssoBase).toBe(7000);
        expect(pb.ssoAmount).toBe(490);          // 9,800 × 5% (ยังไม่แตะเพดาน)
        expect(pb.ssoBase).toBe(9800);
        expect(pc.ssoAmount).toBe(875);          // 18,200 × 5% = 910 → โดน cap 875
        expect(pc.ssoBase).toBe(18200);
        expect(pa.ssoCap).toBe(875);
        expect(pb.ssoCap).toBe(875);
        expect(pc.ssoCap).toBe(875);

        // ครึ่งเดือนหลัง: 15–27 มิ.ย. (13 วัน)
        const p2 = await createWorkerPeriod(2, '2025-06-15', '2025-06-30');
        for (const d of juneDays(15, 27)) await fillSheet([a, b, c], d);
        res = await api.createPayrolls(p2.id);
        expect(res.status).toBe(201);

        pa = await payrollOf(p2.id, a.id);
        pb = await payrollOf(p2.id, b.id);
        pc = await payrollOf(p2.id, c.id);
        expect(pa.ssoAmount).toBe(325);          // 6,500 × 5% (สะสม 675 ยังไม่เต็มเพดาน)
        expect(pb.ssoAmount).toBe(385);          // raw 455 แต่เหลือ quota 875−490 = 385
        expect(pc.ssoAmount).toBe(0);            // หักครบเพดานไปแล้วรอบแรก

        // netPay = regular − sso
        expect(pa.summary.netPay).toBe(6500 - 325);
        expect(pb.summary.netPay).toBe(9100 - 385);
        expect(pc.summary.netPay).toBe(16900 - 0);
    });

    it('ปัดเศษตามกฎสปส — 25.50 → 26 (≥0.50 ปัดขึ้น), 25.15 → 25 (<0.50 ตัด)', async () => {
        await seedConfig(17500);
        const [e510, e503] = seed.employees;
        await setDailyRate(e510.id, 510);
        await setDailyRate(e503.id, 503);

        await fillSheet([e510, e503], '2025-06-02');
        const period = await createWorkerPeriod(1, '2025-06-01', '2025-06-15');
        await api.createPayrolls(period.id);

        expect((await payrollOf(period.id, e510.id)).ssoAmount).toBe(26);
        expect((await payrollOf(period.id, e503.id)).ssoAmount).toBe(25);
    });

    it('ฐานคิดจาก regularAmount เท่านั้น — OT ไม่เข้าฐาน SSO', async () => {
        await seedConfig(17500);
        const emp = seed.employees[0];

        // วันปกติ: ใบ REGULAR 08:00–17:00 + ใบ OT แยก 17:00–18:30 (กฎแยกใบปกติ/OT)
        await fillSheet([emp], '2025-06-02');
        const otSheet = await api.createWorkerTimeSheet({
            workLeaderId: seed.workLeader.id,
            workDate: '2025-06-02',
            allowDuplicate: true,
            pattern: { regular: false, ot: 1.5 },
            entries: [{ employeeId: emp.id, timeIn: '17:00:00', timeOut: '18:30:00', shiftType: 'REGULAR' }],
        });
        expect(otSheet.status).toBe(201);
        await api.updateTimeSheet(otSheet.body.data.id, { status: 'FILLED' });

        const period = await createWorkerPeriod(1, '2025-06-01', '2025-06-15');
        await api.createPayrolls(period.id);

        const p = await payrollOf(period.id, emp.id);
        expect(p.summary.otAmount).toBeGreaterThan(0);
        expect(p.summary.regularAmount).toBe(500);
        expect(p.ssoBase).toBe(500);
        expect(p.ssoAmount).toBe(25);
    });

    it('worker: holiday pay + ค่าจ้างวันลาเต็มวันเข้าฐาน SSO', async () => {
        await seedConfig(17500);
        const emp = seed.employees[0];

        await fillSheet([emp], '2025-06-02');                    // วันทำงาน 500
        await api.createHoliday({ date: '2025-06-03', name: 'วันทดสอบหยุด' });  // holiday 500
        const sick = (await api.getLeaveTypes()).body.data.find((t) => t.name === 'ลาป่วย');
        const leave = await api.createLeave({
            employeeId: emp.id, leaveTypeId: sick.id,
            date: '2025-06-04', timeIn: '08:00', timeOut: '17:00', createBy: user.id,
        });
        expect(leave.status).toBe(201);

        const period = await createWorkerPeriod(1, '2025-06-01', '2025-06-15');
        await api.createPayrolls(period.id);

        const p = await payrollOf(period.id, emp.id);
        expect(p.summary.regularAmount).toBe(1500);   // ทำงาน + holiday + วันลา
        expect(p.ssoBase).toBe(1500);
        expect(p.ssoAmount).toBe(75);
    });

    it('driver รายเดือนเต็มเดือน — sso = ปัด(5% × basePay), ห่างปี OT/ที่พัก', async () => {
        await seedConfig(17500);
        const position = await Position.create({ name: 'TD', code: 'TD', employeeType: 'DRIVER', isActive: true });
        const emp = await Employee.create({
            firstName: 'DRIVER', lastName: 'SSO', idCard: '9500000000001',
            shiftType: 'REGULAR', workLeaderId: seed.workLeader.id,
            startDate: new Date(2026, 0, 1), isActive: true,
        });
        await WageRate.create({
            employeeId: emp.id, positionId: position.id,
            dailyRate: 576.13, hourlyRate: 72.016, minuteRate: 1.2, monthlyRate: 17284,
            effectiveFrom: new Date(2026, 0, 1),
        });

        // พ.ย. 2026: จ–ส ครบทุกวัน (อาทิตย์ 1,8,15,22,29 ไม่มี entry)
        const entries = [];
        for (let d = 2; d <= 30; d++) {
            if ([1, 8, 15, 22, 29].includes(d)) continue;
            entries.push({ date: `2026-11-${String(d).padStart(2, '0')}`, timeIn: '08:00:00', timeOut: '17:00:00', workType: 'REGULAR', otRate: 0, accommodation: 0 });
        }
        const sheet = await api.createDriverTimeSheet({ employeeId: emp.id, monthPeriod: '2026-11', allowDuplicate: false, entries });
        expect(sheet.status).toBe(201);
        await api.updateTimeSheet(sheet.body.data.id, { status: 'FILLED' });

        const period = await api.createPayPeriod({
            periodNo: 11, year: 2026, employeeType: 'DRIVER', startDate: '2026-11-01', endDate: '2026-11-30',
        });
        expect(period.status).toBe(201);
        const pay = await api.createPayrolls(period.body.data.id);
        expect(pay.status).toBe(201);

        const p = await payrollOf(period.body.data.id, emp.id);
        expect(p.summary.basePay).toBe(17284);
        expect(p.ssoBase).toBe(17284);
        expect(p.ssoAmount).toBe(864);               // 864.20 → ตัดเหลือ 864 (ไม่แตะ cap 875)
        expect(p.summary.netPay).toBe(17284 - 864);
    });

    it('driver ขาดทั้งเดือนโดน clamp 0 — basePay 0 → sso 0', async () => {
        await seedConfig(17500);
        const position = await Position.create({ name: 'TD0', code: 'TD0', employeeType: 'DRIVER', isActive: true });
        const emp = await Employee.create({
            firstName: 'DRIVER', lastName: 'ZERO', idCard: '9500000000002',
            shiftType: 'REGULAR', workLeaderId: seed.workLeader.id,
            startDate: new Date(2026, 0, 1), isActive: true,
        });
        await WageRate.create({
            employeeId: emp.id, positionId: position.id,
            dailyRate: 600, hourlyRate: 75, minuteRate: 1.25, monthlyRate: 10000,
            effectiveFrom: new Date(2026, 0, 1),
        });
        // ไม่มี entry เลย — driver ได้ payroll เสมอ (ขาดทั้งรอบ)

        const period = await api.createPayPeriod({
            periodNo: 11, year: 2026, employeeType: 'DRIVER', startDate: '2026-11-01', endDate: '2026-11-30',
        });
        const pay = await api.createPayrolls(period.body.data.id);
        expect(pay.status).toBe(201);

        const p = await payrollOf(period.body.data.id, emp.id);
        expect(p.summary.basePay).toBe(0);
        expect(p.ssoBase).toBe(0);
        expect(p.ssoAmount).toBe(0);
    });

    it('ไม่มี sso_config ครอบช่วง → sso = 0 + warning ใน response (ไม่บล็อก)', async () => {
        const emp = seed.employees[0];
        await fillSheet([emp], '2025-06-02');
        const period = await createWorkerPeriod(1, '2025-06-01', '2025-06-15');

        const res = await api.createPayrolls(period.id);
        expect(res.status).toBe(201);
        expect(res.body.warnings).toHaveLength(1);
        expect(res.body.warnings[0]).toContain('SSO');

        const p = await payrollOf(period.id, emp.id);
        expect(p.ssoAmount).toBe(0);
        expect(p.ssoBase).toBeNull();
        expect(p.ssoCap).toBeNull();
    });

    it('สร้างรอบหลังก่อนรอบแรก → เกินเพดานชั่วคราว, recalculate รอบหลังแก้ให้เอง', async () => {
        await seedConfig(17500);
        const b = seed.employees[1];
        await setDailyRate(b.id, 700);

        // รอบสอง (15–27) ก่อน
        const p2 = await createWorkerPeriod(2, '2025-06-15', '2025-06-30');
        for (const d of juneDays(15, 27)) await fillSheet([b], d);
        await api.createPayrolls(p2.id);
        expect((await payrollOf(p2.id, b.id)).ssoAmount).toBe(455);  // ยังไม่เห็นรอบแรก → หักเต็ม

        // รอบแรก (1–14) ทีหลัง
        const p1 = await createWorkerPeriod(1, '2025-06-01', '2025-06-14');
        for (const d of juneDays(1, 14)) await fillSheet([b], d);
        await api.createPayrolls(p1.id);
        expect((await payrollOf(p1.id, b.id)).ssoAmount).toBe(490);

        // รวม 945 > 875 → recalc รอบหลังต้องลดเหลือ 385
        const p2Payroll = await payrollOf(p2.id, b.id);
        const recalc = await api.recalculatePayroll(p2Payroll.id);
        expect(recalc.status).toBe(200);
        expect((await payrollOf(p2.id, b.id)).ssoAmount).toBe(385);
    });

    it('แก้ ssoAmount มือแล้ว recalculate → กลับมาตามสูตรเสมอ', async () => {
        await seedConfig(17500);
        const a = seed.employees[0];

        await fillSheet([a], '2025-06-02');
        const period = await createWorkerPeriod(1, '2025-06-01', '2025-06-15');
        await api.createPayrolls(period.id);
        const p = await payrollOf(period.id, a.id);
        expect(p.ssoAmount).toBe(25);

        const edited = await api.updatePayroll(p.id, { ssoAmount: 999 });
        expect(edited.status).toBe(200);
        expect((await payrollOf(period.id, a.id)).ssoAmount).toBe(999);

        const recalc = await api.recalculatePayroll(p.id);
        expect(recalc.status).toBe(200);
        expect((await payrollOf(period.id, a.id)).ssoAmount).toBe(25);
    });

    it('cancel รอบแรกแล้ว recalc รอบสอง → ได้ quota เต็มใหม่', async () => {
        await seedConfig(17500);
        const b = seed.employees[1];
        await setDailyRate(b.id, 700);

        const p1 = await createWorkerPeriod(1, '2025-06-01', '2025-06-14');
        for (const d of juneDays(1, 14)) await fillSheet([b], d);
        await api.createPayrolls(p1.id);
        const p2 = await createWorkerPeriod(2, '2025-06-15', '2025-06-30');
        for (const d of juneDays(15, 27)) await fillSheet([b], d);
        await api.createPayrolls(p2.id);
        expect((await payrollOf(p2.id, b.id)).ssoAmount).toBe(385);

        const p1Payroll = await payrollOf(p1.id, b.id);
        const cancelled = await api.cancelPayroll(p1Payroll.id);
        expect(cancelled.status).toBe(200);

        const p2Payroll = await payrollOf(p2.id, b.id);
        await api.recalculatePayroll(p2Payroll.id);
        expect((await payrollOf(p2.id, b.id)).ssoAmount).toBe(455);  // รอบแรกถูก cancel → quota เต็ม 875
    });

    it('PayPeriod ข้ามเดือนปฏิทิน → 422', async () => {
        const res = await api.createPayPeriod({
            periodNo: 3, year: 2025, employeeType: 'WORKER',
            startDate: '2025-06-20', endDate: '2025-07-05',
        });
        expect(res.status).toBe(422);
        expect(res.body.error.message).toContain('เดือนเดียวกัน');
    });

    it('config ใช้ตาม endDate ของรอบ — ธ.ค. 2025 เพดาน 750 / ม.ค. 2026 เพดาน 875', async () => {
        await seedConfig(15000, '2020-01-01', '2025-12-31');
        await seedConfig(17500, '2026-01-01', null);
        const a = seed.employees[0];

        const dec = await api.createPayPeriod({
            periodNo: 12, year: 2025, employeeType: 'WORKER', startDate: '2025-12-01', endDate: '2025-12-15',
        });
        for (let d = 1; d <= 10; d++) await fillSheet([a], `2025-12-${String(d).padStart(2, '0')}`);
        await api.createPayrolls(dec.body.data.id);

        const jan = await api.createPayPeriod({
            periodNo: 1, year: 2026, employeeType: 'WORKER', startDate: '2026-01-01', endDate: '2026-01-15',
        });
        for (let d = 2; d <= 11; d++) await fillSheet([a], `2026-01-${String(d).padStart(2, '0')}`);
        await api.createPayrolls(jan.body.data.id);

        const decP = await payrollOf(dec.body.data.id, a.id);
        const janP = await payrollOf(jan.body.data.id, a.id);
        expect(decP.ssoCap).toBe(750);              // 5% × 15,000
        expect(janP.ssoCap).toBe(875);              // 5% × 17,500
        expect(decP.ssoAmount).toBe(250);           // 5,000 × 5%
        expect(janP.ssoAmount).toBe(250);
    });
});

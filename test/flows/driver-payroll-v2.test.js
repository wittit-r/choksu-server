import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { cleanDatabase, disconnectPrisma } from '../helpers/db.js';
import { createTestAuth } from '../helpers/auth.js';
import { seedTestData } from '../helpers/seed.js';
import { createApiClient } from '../helpers/client.js';
import { Position, Employee, WageRate } from '../../src/database/index.js';
import IORedis from 'ioredis';

// Driver payroll v2 (spec PAYROLL-LEAVE-SPEC-DRAFT.md section D)
// ตัวเลข golden ทั้งหมดมาจาก "แผ่นจ่ายเงินจริง" ใน spec — ตรวจสอบการคำนวณแล้ว:
// - เงินพื้นฐาน = monthlyRate − (ขาดย่อยหน่วย: วัน×daily + ชม.×hourly + นาที×minute)
// - เข้าใหม่กลางเดือน = วันสุทธิ × dailyRate (เคสนายเอ 16 วัน)
// - อาทิตย์/นักขัตฤกษ์/วันลา = ไม่มีชั่วโมงคาดหวัง
// - clamp ยอดจ่ายที่ 0
//
// พ.ย. 2026: อาทิตย์ = 1, 8, 15, 22, 29 → วัน จ–ส = 25 วัน
describe('Driver Payroll v2 — golden cases จากแผ่นจ่ายจริง', () => {
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
        await api.generateEntitlements({ year: 2026 });
    });

    afterAll(async () => {
        await redis.quit();
        await disconnectPrisma();
    });

    const driverPosition = async () => Position.create({
        name: 'Test Driver', code: 'TD', employeeType: 'DRIVER', isActive: true,
    });

    async function createDriver({ rate, startDate = '2026-01-01' }) {
        const [y, m, d] = startDate.split('-').map(Number);
        const position = await driverPosition();
        const employee = await Employee.create({
            firstName: 'DRIVER',
            lastName: `T${Math.floor(Math.random() * 100000)}`,
            idCard: String(Math.floor(Math.random() * 1e13)).padStart(13, '0'),
            shiftType: 'REGULAR',
            workLeaderId: seed.workLeader.id,
            startDate: new Date(y, m - 1, d),
            isActive: true,
        });
        await WageRate.create({
            employeeId: employee.id, positionId: position.id,
            ...rate, effectiveFrom: new Date(2026, 0, 1),
        });
        return employee;
    }

    // สร้าง REGULAR 08:00–17:00 ทุกวัน จ–ส ของ พ.ย. 2026 (ยกเว้นวันใน skipDates)
    const novRegulars = (skipDates = []) => {
        const entries = [];
        for (let d = 2; d <= 30; d++) {
            const date = `2026-11-${String(d).padStart(2, '0')}`;
            const day = new Date(2026, 10, d).getDay();
            if (day === 0 || skipDates.includes(date)) continue;
            entries.push({ date, timeIn: '08:00:00', timeOut: '17:00:00', workType: 'REGULAR', otRate: 0, accommodation: 0 });
        }
        return entries;
    };

    async function runPayroll(employeeId, entries) {
        const sheet = await api.createDriverTimeSheet({
            employeeId, monthPeriod: '2026-11', allowDuplicate: false, entries,
        });
        expect(sheet.status).toBe(201);
        await api.updateTimeSheet(sheet.body.data.id, { status: 'FILLED' });

        const period = await api.createPayPeriod({
            periodNo: 11, year: 2026, employeeType: 'DRIVER',
            startDate: '2026-11-01', endDate: '2026-11-30',
        });
        expect(period.status).toBe(201);
        const pay = await api.createPayrolls(period.body.data.id);
        expect(pay.status).toBe(201);

        const detail = await api.getPayPeriodById(period.body.data.id);
        expect(detail.status).toBe(200);
        return detail.body.data.payrolls.find((p) => p.employeeId === employeeId).summary;
    }

    it('นายทดสอบ: เดือนเต็มมาครบ + ที่พัก 2 คืน → 17,284 + 800 = 18,084.00', async () => {
        const emp = await createDriver({
            rate: { dailyRate: 576.13, hourlyRate: 72.016, minuteRate: 1.2, monthlyRate: 17284 },
        });
        const entries = [
            ...novRegulars(),
            { date: '2026-11-02', timeIn: null, timeOut: null, workType: 'ACCOMMODATION', otRate: 0, accommodation: 400 },
            { date: '2026-11-03', timeIn: null, timeOut: null, workType: 'ACCOMMODATION', otRate: 0, accommodation: 400 },
        ];

        const s = await runPayroll(emp.id, entries);
        expect(s.payMode).toBe('MONTHLY');
        expect(s.monthlyRate).toBe(17284);
        expect(s.absentMinutes).toBe(0);
        expect(s.absenceDeduction).toBe(0);
        expect(s.basePay).toBe(17284);
        expect(s.accommodationAmount).toBe(800);
        expect(s.netPay).toBe(18084);
    });

    it('นายเอ: เข้าใหม่ 12 พ.ย. ทำ 16 วัน + OT 1× 8 ชม. + ที่พัก 4 คืน → 9,218.08 + 576.13 + 1,600 = 11,394.21', async () => {
        const emp = await createDriver({
            rate: { dailyRate: 576.13, hourlyRate: 72.016, minuteRate: 1.2, monthlyRate: 17284 },
            startDate: '2026-11-12',
        });

        // จ–ส ตั้งแต่ 12 พ.ย. = 16 วัน (12,13,14,16-21,23-28,30)
        const entries = novRegulars().filter((e) => e.date >= '2026-11-12');
        expect(entries).toHaveLength(16);
        // OT 1 เท่า 8 ชม. ก้อนเดียว — วันอาทิตย์ 22 พ.ย. 09:00–17:00 = 480 นาที
        // (OT ไม่หักพักเที่ยง; อาทิตย์ OT ได้ทุกช่วง; ปัดที่ก้อนเดียวตามแผ่นจริง = 8×72.016 = 576.13)
        entries.push({ date: '2026-11-22', timeIn: '09:00:00', timeOut: '17:00:00', workType: 'OVERTIME', otRate: 1, accommodation: 0 });
        // ที่พัก 4 คืน
        for (const d of ['2026-11-12', '2026-11-13', '2026-11-14', '2026-11-16']) {
            entries.push({ date: d, timeIn: null, timeOut: null, workType: 'ACCOMMODATION', otRate: 0, accommodation: 400 });
        }

        const s = await runPayroll(emp.id, entries);
        expect(s.payMode).toBe('DAILY');
        expect(s.netDays).toBe(16);
        expect(s.basePay).toBe(9218.08);       // 16 × 576.13
        expect(s.otAmount).toBe(576.13);        // 72.016 × 8 ปัด 2 ตำแหน่ง
        expect(s.accommodationAmount).toBe(1600);
        expect(s.netPay).toBe(11394.21);
    });

    it('นายโอ: ขาด 1 วันเต็ม + ขาด 6 ชม. (มา 08:00–10:00) → หัก 763.67 → basePay 12,327.33', async () => {
        const emp = await createDriver({
            rate: { dailyRate: 436.37, hourlyRate: 54.55, minuteRate: 0.909, monthlyRate: 13091 },
        });

        // ขาดเต็มวัน 13 พ.ย. + วันที่ 16 มาแค่ 08:00–10:00 (ขาด 360 นาที)
        const entries = [
            ...novRegulars(['2026-11-13', '2026-11-16']),
            { date: '2026-11-16', timeIn: '08:00:00', timeOut: '10:00:00', workType: 'REGULAR', otRate: 0, accommodation: 0 },
        ];

        const s = await runPayroll(emp.id, entries);
        expect(s.payMode).toBe('MONTHLY');
        expect(s.absentMinutes).toBe(840);      // 480 + 360
        expect(s.absenceDeduction).toBe(763.67); // 1×436.37 + 6×54.55
        expect(s.basePay).toBe(12327.33);        // 13,091 − 763.67
        expect(s.netPay).toBe(12327.33);
    });

    it('นายฉ: เดือนเต็ม + OT 1× 1 ชม. + OT 3× 4 ชม. → 16,304 + 67.93 + 815.16 = 17,187.09', async () => {
        const emp = await createDriver({
            rate: { dailyRate: 543.47, hourlyRate: 67.93, minuteRate: 1.132, monthlyRate: 16304 },
        });

        const entries = [
            ...novRegulars(),
            // OT 1× หลังเลิกงาน (จ–ส) 1 ชม.
            { date: '2026-11-02', timeIn: '17:00:00', timeOut: '18:00:00', workType: 'OVERTIME', otRate: 1, accommodation: 0 },
            // OT 3× วันอาทิตย์ (ไม่มีเวลาปกติ — OT ได้ทุกช่วง)
            { date: '2026-11-08', timeIn: '08:00:00', timeOut: '12:00:00', workType: 'OVERTIME', otRate: 3, accommodation: 0 },
        ];

        const s = await runPayroll(emp.id, entries);
        expect(s.basePay).toBe(16304);
        expect(s.otAmount).toBe(883.09);        // 67.93 + 4×67.93×3
        expect(s.netPay).toBe(17187.09);
    });

    it('clamp ที่ 0: ขาดจน monthlyRate − หัก ติดลบ → basePay/netPay = 0', async () => {
        const emp = await createDriver({
            rate: { dailyRate: 500, hourlyRate: 62.5, minuteRate: 1.042, monthlyRate: 10000 },
        });

        // มาแค่ 4 วัน → ขาด 21 วัน × 500 = 10,500 > 10,000
        const worked = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'];
        const entries = novRegulars().filter((e) => worked.includes(e.date));

        const s = await runPayroll(emp.id, entries);
        expect(s.absentMinutes).toBe(21 * 480);
        expect(s.absenceDeduction).toBe(10500);
        expect(s.basePay).toBe(0);
        expect(s.netPay).toBe(0);
    });

    it('วันลาไม่นับเป็นขาด: ลาเต็มวัน 1 วันที่ไม่มา → absentMinutes = 0', async () => {
        const emp = await createDriver({
            rate: { dailyRate: 436.37, hourlyRate: 54.55, minuteRate: 0.909, monthlyRate: 13091 },
        });
        // driver ถูกสร้างหลัง generate ครั้งแรก → generate ซ้ำให้มีสิทธิ์ (idempotent)
        await api.generateEntitlements({ year: 2026 });

        const types = await api.getLeaveTypes();
        const sick = types.body.data.find((t) => t.name === 'ลาป่วย');
        const leave = await api.createLeave({
            employeeId: emp.id, leaveTypeId: sick.id,
            date: '2026-11-13', timeIn: '08:00', timeOut: '17:00', createBy: user.id,
        });
        expect(leave.status).toBe(201);

        const entries = novRegulars(['2026-11-13']);
        const s = await runPayroll(emp.id, entries);
        expect(s.absentMinutes).toBe(0);
        expect(s.basePay).toBe(13091);
        expect(s.netPay).toBe(13091);
    });

    it('OT validation: คร่อม 08:00–17:00 จ–ส → 422 / หลัง 17:00 / วันอาทิตย์ / วันนักขัตฤกษ์ → ผ่าน', async () => {
        const emp = await createDriver({
            rate: { dailyRate: 576.13, hourlyRate: 72.016, minuteRate: 1.2, monthlyRate: 17284 },
        });

        const overlap = await api.createDriverTimeSheet({
            employeeId: emp.id, monthPeriod: '2026-11', allowDuplicate: false,
            entries: [
                { date: '2026-11-02', timeIn: '10:00:00', timeOut: '20:00:00', workType: 'OVERTIME', otRate: 1.5, accommodation: 0 },
            ],
        });
        expect(overlap.status).toBe(422);
        expect(overlap.body.error.message).toContain('08:00–17:00');

        const earlyMorning = await api.createDriverTimeSheet({
            employeeId: emp.id, monthPeriod: '2026-11', allowDuplicate: false,
            entries: [
                { date: '2026-11-02', timeIn: '05:00:00', timeOut: '07:30:00', workType: 'OVERTIME', otRate: 1.5, accommodation: 0 },
            ],
        });
        expect(earlyMorning.status).toBe(201);

        // อาทิตย์ OT ช่วงไหนก็ได้
        const sunday = await api.createDriverTimeSheet({
            employeeId: emp.id, monthPeriod: '2026-12', allowDuplicate: false,
            entries: [
                { date: '2026-12-06', timeIn: '08:00:00', timeOut: '12:00:00', workType: 'OVERTIME', otRate: 3, accommodation: 0 },
            ],
        });
        expect(sunday.status).toBe(201);

        // นักขัตฤกษ์ (สร้าง holiday) OT กลางวันได้
        await api.createHoliday({ date: '2026-12-07', name: 'วันทดสอบหยุด' });
        const holiday = await api.createDriverTimeSheet({
            employeeId: emp.id, monthPeriod: '2026-12', allowDuplicate: true,
            entries: [
                { date: '2026-12-07', timeIn: '09:00:00', timeOut: '12:00:00', workType: 'OVERTIME', otRate: 3, accommodation: 0 },
            ],
        });
        expect(holiday.status).toBe(201);
    });
});

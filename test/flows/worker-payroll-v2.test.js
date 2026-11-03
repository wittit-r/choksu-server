import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { cleanDatabase, disconnectPrisma } from '../helpers/db.js';
import { createTestAuth } from '../helpers/auth.js';
import { seedTestData } from '../helpers/seed.js';
import { createApiClient } from '../helpers/client.js';
import { TimeEntry, Employee, WageRate } from '../../src/database/index.js';
import IORedis from 'ioredis';

// Worker payroll v2 (spec PAYROLL-LEAVE-SPEC-DRAFT.md section C)
// - ค่าจ้างพื้นฐานคิดต่อวัน: นาทีทำงานจริง + นาทีลา → ≥480 = dailyRate / <480 = ย่อยหน่วย
// - วันหยุดนักขัตฤกษ์: ได้ dailyRate อัตโนมัติ (+ ซ้อนกับ entry holiday_2x/3x ได้อีกชั้น)
// - วันลาที่ไม่มี entry (ลาเต็มวันไม่มา) = จ่ายตอนสรุปยอด (leaveOnlyPay)
// - ห้ามลง pattern ปกติในวันนักขัตฤกษ์
// ค่าจ้าง seed: dailyRate 500, hourlyRate 62.5, minuteRate 1.042
describe('Worker Payroll v2 — วันลา/วันหยุดเข้าสูตรค่าจ้าง', () => {
    let redis, api, seed, user;
    const RATE = { daily: 500, hourly: 62.5, minute: 1.042 };

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
    });

    afterAll(async () => {
        await redis.quit();
        await disconnectPrisma();
    });

    const typeByName = async (name) => {
        const res = await api.getLeaveTypes();
        return res.body.data.find((t) => t.name === name);
    };

    async function fillSheet(employees, workDate, timeIn = '08:00:00', timeOut = '17:00:00', pattern = { regular: true, ot: 0 }) {
        const res = await api.createWorkerTimeSheet({
            workLeaderId: seed.workLeader.id,
            workDate,
            pattern,
            entries: employees.map((emp) => ({
                employeeId: emp.id,
                timeIn,
                timeOut,
                shiftType: 'REGULAR',
            })),
        });
        expect(res.status).toBe(201);
        const fill = await api.updateTimeSheet(res.body.data.id, { status: 'FILLED' });
        expect(fill.status).toBe(200);
        return res.body.data;
    }

    async function makePeriodAndPayroll(workDate, { startDate = '2025-06-01', endDate = '2025-06-15' } = {}) {
        const period = await api.createPayPeriod({
            periodNo: 1, year: 2025, employeeType: 'WORKER', startDate, endDate,
        });
        expect(period.status).toBe(201);

        const pay = await api.createPayrolls(period.body.data.id, {});
        expect(pay.status).toBe(201);

        const detail = await api.getPayPeriodById(period.body.data.id);
        expect(detail.status).toBe(200);
        return detail.body.data;
    }

    const paidValueOf = async (employeeId) => {
        const entries = await TimeEntry.findAll({
            where: { employeeId, workType: 'REGULAR', isNegative: false },
            order: [['startTime', 'ASC']],
        });
        return entries.map((e) => Number(e.paidValue));
    };

    it('วันเต็มอย่างเดียว 08:00–17:00 (480) → paidValue = dailyRate (regression)', async () => {
        const emp = seed.employees[0];
        await fillSheet([emp], '2025-06-02');
        const period = await makePeriodAndPayroll('2025-06-02');

        expect(await paidValueOf(emp.id)).toEqual([RATE.daily]);
        expect(period.payrolls[0].summary.regularAmount).toBe(RATE.daily);
        expect(period.payrolls[0].summary.workingDays).toBe(1);
    });

    it('ทำงาน 7 ชม. + ลา 3 ชม. (คร่อมพักเที่ยงแล้วเหลือ 480) → เต็มวัน dailyRate', async () => {
        const emp = seed.employees[0];
        await fillSheet([emp], '2025-06-02', '08:00:00', '15:00:00'); // 360 นาทีหลังหักพัก
        const sick = await typeByName('ลาป่วย');
        const leave = await api.createLeave({
            employeeId: emp.id, leaveTypeId: sick.id,
            date: '2025-06-02', timeIn: '15:00', timeOut: '17:00', createBy: user.id,
        });
        expect(leave.status).toBe(201);

        const period = await makePeriodAndPayroll('2025-06-02');
        expect(await paidValueOf(emp.id)).toEqual([RATE.daily]);
        expect(period.payrolls[0].summary.workingDays).toBe(1);
    });

    it('ทำงาน 4 ชม. + ลา 2 ชม. = 360 นาที → ย่อยหน่วย 6×62.5 = 375', async () => {
        const emp = seed.employees[0];
        await fillSheet([emp], '2025-06-02', '08:00:00', '12:00:00'); // 240
        const sick = await typeByName('ลาป่วย');
        const leave = await api.createLeave({
            employeeId: emp.id, leaveTypeId: sick.id,
            date: '2025-06-02', timeIn: '13:00', timeOut: '15:00', createBy: user.id, // 120 (ไม่คร่อมพัก)
        });
        expect(leave.status).toBe(201);

        const period = await makePeriodAndPayroll('2025-06-02');
        expect(await paidValueOf(emp.id)).toEqual([6 * RATE.hourly]);
        expect(period.payrolls[0].summary.workingDays).toBe(0.75);
    });

    it('วันหยุดนักขัตฤกษ์ ไม่มาทำงาน → holidayAmount = dailyRate อัตโนมัติ', async () => {
        const emp = seed.employees[0];
        await api.createHoliday({ date: '2025-06-02', name: 'วันทดสอบหยุด' });
        // ทำงานวันอื่นให้เกิด payroll (3 มิ.ย.)
        await fillSheet([emp], '2025-06-03');

        const period = await makePeriodAndPayroll('2025-06-03');
        const summary = period.payrolls[0].summary;

        expect(summary.holidayDays).toBe(1);
        expect(summary.holidayAmount).toBe(RATE.daily);
        expect(summary.regularAmount).toBe(RATE.daily * 2); // วันทำงาน + วันหยุด
        expect(summary.netPay).toBe(RATE.daily * 2);
        expect(summary.workingDays).toBe(2);
    });

    it('มาทำงานวันนักขัตฤกษ์แบบ holiday_2x → entry 2× + holiday pay 1× ซ้อน = 3×dailyRate', async () => {
        const emp = seed.employees[0];
        await api.createHoliday({ date: '2025-06-02', name: 'วันทดสอบหยุด' });
        await fillSheet([emp], '2025-06-02', '08:00:00', '17:00:00', { regular: false, ot: 2 });

        const period = await makePeriodAndPayroll('2025-06-02');
        const summary = period.payrolls[0].summary;

        // entry holiday_2x = OVERTIME 08:00–17:00 → dailyRate × 2 (สูตร OT ≥480)
        expect(summary.otAmount).toBe(RATE.daily * 2);
        expect(summary.holidayAmount).toBe(RATE.daily);
        expect(summary.regularAmount).toBe(RATE.daily);
        expect(summary.netPay).toBe(RATE.daily * 3);
    });

    it('ลาเต็มวันไม่มาทำงาน (ไม่มี entry เลย) → เกิด payroll + leaveOnlyAmount = dailyRate', async () => {
        const emp = seed.employees[0];
        const sick = await typeByName('ลาป่วย');
        const leave = await api.createLeave({
            employeeId: emp.id, leaveTypeId: sick.id,
            date: '2025-06-02', timeIn: '08:00', timeOut: '17:00', createBy: user.id,
        });
        expect(leave.status).toBe(201);

        const period = await api.createPayPeriod({
            periodNo: 1, year: 2025, employeeType: 'WORKER',
            startDate: '2025-06-01', endDate: '2025-06-15',
        });
        const pay = await api.createPayrolls(period.body.data.id, {});
        expect(pay.status).toBe(201);
        expect(pay.body.created).toBe(1);

        const detail = await api.getPayPeriodById(period.body.data.id);
        const summary = detail.body.data.payrolls[0].summary;
        expect(summary.leaveOnlyAmount).toBe(RATE.daily);
        expect(summary.regularAmount).toBe(RATE.daily);
        expect(summary.netPay).toBe(RATE.daily);
        expect(summary.workingDays).toBe(1);
    });

    it('ลาครึ่งวันไม่มาทำงาน → leaveOnlyAmount = 4×62.5 = 250, workingDays 0.5', async () => {
        const emp = seed.employees[0];
        const sick = await typeByName('ลาป่วย');
        await api.createLeave({
            employeeId: emp.id, leaveTypeId: sick.id,
            date: '2025-06-02', timeIn: '08:00', timeOut: '12:00', createBy: user.id,
        });

        const period = await makePeriodAndPayroll(null);
        const summary = period.payrolls[0].summary;
        expect(summary.leaveOnlyAmount).toBe(4 * RATE.hourly);
        expect(summary.workingDays).toBe(0.5);
        expect(summary.netPay).toBe(4 * RATE.hourly);
    });

    it('ห้ามลง pattern ปกติในวันนักขัตฤกษ์ — ต้องเป็น holiday_2x/3x เท่านั้น (422)', async () => {
        const emp = seed.employees[0];
        await api.createHoliday({ date: '2025-06-02', name: 'วันทดสอบหยุด' });

        const normal = await api.createWorkerTimeSheet({
            workLeaderId: seed.workLeader.id,
            workDate: '2025-06-02',
            pattern: { regular: true, ot: 0 },
            entries: [{ employeeId: emp.id, timeIn: '08:00:00', timeOut: '17:00:00', shiftType: 'REGULAR' }],
        });
        expect(normal.status).toBe(422);
        expect(normal.body.error.message).toContain('นักขัตฤกษ์');

        const ot15 = await api.createWorkerTimeSheet({
            workLeaderId: seed.workLeader.id,
            workDate: '2025-06-02',
            pattern: { regular: false, ot: 1.5 },
            entries: [{ employeeId: emp.id, timeIn: '08:00:00', timeOut: '17:00:00', shiftType: 'REGULAR' }],
        });
        expect(ot15.status).toBe(422);

        const holiday2x = await api.createWorkerTimeSheet({
            workLeaderId: seed.workLeader.id,
            workDate: '2025-06-02',
            pattern: { regular: false, ot: 2 },
            entries: [{ employeeId: emp.id, timeIn: '08:00:00', timeOut: '17:00:00', shiftType: 'REGULAR' }],
        });
        expect(holiday2x.status).toBe(201);
    });

    it('ใบลงเวลาค้าง PENDING → 409 พร้อมรายชื่อ / ยืนยันข้าม allowPendingSheets → สร้างได้', async () => {
        const emp = seed.employees[0];
        // สร้างใบแต่ "ไม่" เปลี่ยนสถานะเป็น FILLED
        const sheet = await api.createWorkerTimeSheet({
            workLeaderId: seed.workLeader.id,
            workDate: '2025-06-02',
            pattern: { regular: true, ot: 0 },
            entries: [{ employeeId: emp.id, timeIn: '08:00:00', timeOut: '17:00:00', shiftType: 'REGULAR' }],
        });
        expect(sheet.status).toBe(201);

        const period = await api.createPayPeriod({
            periodNo: 1, year: 2025, employeeType: 'WORKER',
            startDate: '2025-06-01', endDate: '2025-06-15',
        });

        // ไม่ส่ง flag → 409 พร้อมรายชื่อใบค้าง
        const blocked = await api.createPayrolls(period.body.data.id, {});
        expect(blocked.status).toBe(409);
        expect(blocked.body.error.code).toBe('CONFLICT');
        expect(blocked.body.error.details.pendingSheets).toHaveLength(1);
        expect(blocked.body.error.details.pendingSheets[0].employeeName).toContain('Worker1');

        // ยืนยันข้าม → สร้างได้ (ใบ PENDING ไม่มี entry ถูกนับ → created 0 สำหรับคนนี้)
        const forced = await api.createPayrolls(period.body.data.id, { allowPendingSheets: true });
        expect(forced.status).toBe(201);

        // ปรับใบเป็น FILLED แล้วสร้างอีกครั้ง → entry ถูกนับครบ
        await api.updateTimeSheet(sheet.body.data.id, { status: 'FILLED' });
        const again = await api.createPayrolls(period.body.data.id, {});
        expect(again.status).toBe(201);
        expect(again.body.created).toBe(1);
        expect(await paidValueOf(emp.id)).toEqual([RATE.daily]);
    });

    it('วันหยุดก่อนวันเริ่มงานของพนักงาน → ไม่นับ holiday pay', async () => {
        // พนักงานเริ่ม 2025-06-05 — วันหยุด 2025-06-02 อยู่ก่อน startDate ไม่ได้เงิน
        const lateEmp = await Employee.create({
            firstName: 'เข้าใหม่', lastName: 'Test',
            idCard: '9400000000001', shiftType: 'REGULAR',
            workLeaderId: seed.workLeader.id,
            startDate: new Date(2025, 5, 5), isActive: true,
        });
        await WageRate.create({
            employeeId: lateEmp.id, positionId: seed.workerPosition.id,
            dailyRate: RATE.daily, hourlyRate: RATE.hourly, minuteRate: RATE.minute,
            monthlyRate: 0, effectiveFrom: new Date(2025, 0, 1),
        });
        await api.createHoliday({ date: '2025-06-02', name: 'วันทดสอบหยุด' });
        await api.generateEntitlements({ year: 2025 });
        await fillSheet([lateEmp], '2025-06-06');

        const period = await makePeriodAndPayroll('2025-06-06');
        const summary = period.payrolls.find((p) => p.employeeId === lateEmp.id).summary;
        expect(summary.holidayDays).toBe(0);
        expect(summary.holidayAmount).toBe(0);
        expect(summary.regularAmount).toBe(RATE.daily);
    });
});

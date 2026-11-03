import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { cleanDatabase, disconnectPrisma } from '../helpers/db.js';
import { createTestAuth } from '../helpers/auth.js';
import { seedTestData } from '../helpers/seed.js';
import { createApiClient } from '../helpers/client.js';
import { Employee, TimeSheet, TimeEntry } from '../../src/database/index.js';
import { combineDateAndTime } from '../../src/utils/date.js';
import IORedis from 'ioredis';

// Leave / LeaveType / LeaveEntitlement / Holiday — CRUD + validation ครบทุกข้อตาม spec section B
// (expected ทั้งหมดอิง spec PAYROLL-LEAVE-SPEC-DRAFT.md — นาทีลาหักพัก 12:00–13:00, 1 วัน = 480 นาที)
describe('CRUD: leaves / leave-types / leave-entitlements / holidays', () => {
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

        // ชนิดวันลามาตรฐาน 3 ชนิด (ตาม seed จริง 30/7/3) + ชนิดจิ๋วสำหรับเทสสิทธิ์
        await api.createLeaveType({ name: 'ลาป่วย', defaultDaysPerYear: 30 });
        await api.createLeaveType({ name: 'พักร้อน', defaultDaysPerYear: 7 });
        await api.createLeaveType({ name: 'ลากิจ', defaultDaysPerYear: 3 });
        await api.createLeaveType({ name: 'เทสจิ๋ว', defaultDaysPerYear: 1 });
    });

    afterAll(async () => {
        await redis.quit();
        await disconnectPrisma();
    });

    const typeByName = async (name) => {
        const res = await api.getLeaveTypes();
        return res.body.data.find((t) => t.name === name);
    };

    // helper สร้าง REGULAR entry ตรงๆ ผ่าน model (สำหรับเทสซ้อนทับ/quota)
    const createEntry = async (employeeId, date, timeIn, timeOut) => {
        const [y, m, d] = date.split('-').map(Number);
        const sheet = await TimeSheet.create({
            workLeaderId: seed.workLeader.id,
            workDate: new Date(y, m - 1, d),
            employeeId,
            sheetType: 'DAILY',
            status: 'FILLED',
            createBy: user.id,
        });
        return TimeEntry.create({
            timeSheetId: sheet.id,
            employeeId,
            startTime: combineDateAndTime(date, `${timeIn}:00`),
            endTime: combineDateAndTime(date, `${timeOut}:00`),
            shiftType: 'REGULAR',
            workType: 'REGULAR',
            otRate: 0,
            accommodation: 0,
            isNegative: false,
            isRetro: false,
            status: 'DRAFT',
        });
    };

    describe('holidays', () => {
        it('should create + list by year + delete', async () => {
            const created = await api.createHoliday({ date: '2026-12-05', name: 'วันพ่อ' });
            expect(created.status).toBe(201);
            await api.createHoliday({ date: '2027-01-01', name: 'วันปีใหม่' });

            const y2026 = await api.getHolidays({ year: 2026 });
            expect(y2026.status).toBe(200);
            expect(y2026.body.data).toHaveLength(1);
            expect(y2026.body.data[0].name).toBe('วันพ่อ');

            const del = await api.deleteHoliday(created.body.data.id);
            expect(del.status).toBe(200);
            expect((await api.getHolidays()).body.data).toHaveLength(1);
        });

        it('should reject duplicate holiday date with 409', async () => {
            await api.createHoliday({ date: '2026-12-05', name: 'วันพ่อ' });
            const dup = await api.createHoliday({ date: '2026-12-05', name: 'วันพ่อซ้ำ' });
            expect(dup.status).toBe(409);
            expect(dup.body.error.code).toBe('CONFLICT');
        });
    });

    describe('leave-types', () => {
        it('should reject duplicate name with 409', async () => {
            const res = await api.createLeaveType({ name: 'ลาป่วย', defaultDaysPerYear: 30 });
            expect(res.status).toBe(409);
        });

        it('should update name/default/isActive', async () => {
            const type = await typeByName('ลากิจ');
            const res = await api.updateLeaveType(type.id, { defaultDaysPerYear: 5, isActive: false });
            expect(res.status).toBe(200);
            expect(res.body.data.defaultDaysPerYear).toBe(5);
            expect(res.body.data.isActive).toBe(false);
        });

        it('should hard-delete when not referenced, but block when referenced', async () => {
            const orphan = await api.createLeaveType({ name: 'ไม่มีคนใช้', defaultDaysPerYear: 1 });
            expect((await api.deleteLeaveType(orphan.body.data.id)).status).toBe(200);

            // ถูกอ้างโดย entitlement → ห้ามลบ
            const gen = await api.generateEntitlements({ year: 2026 });
            expect(gen.status).toBe(201);
            const sick = await typeByName('ลาป่วย');
            const blocked = await api.deleteLeaveType(sick.id);
            expect(blocked.status).toBe(422);
            expect(blocked.body.error.message).toContain('ปิดการใช้งาน');
        });
    });

    describe('leave-entitlements: generate + prorata', () => {
        it('should generate for all active employees × active types, idempotent', async () => {
            const res = await api.generateEntitlements({ year: 2026 });
            expect(res.status).toBe(201);
            // 5 พนักงาน × 4 ชนิด = 20
            expect(res.body.data.created).toBe(20);

            const again = await api.generateEntitlements({ year: 2026 });
            expect(again.body.data.created).toBe(0);
        });

        it('should prorata with ceil for mid-year starters (เดือนที่เริ่ม = เดือนแรก)', async () => {
            await Employee.create({
                firstName: 'เข้ากลางปี', lastName: 'Test',
                idCard: '9100000000001', shiftType: 'REGULAR',
                workLeaderId: seed.workLeader.id,
                startDate: new Date(2026, 6, 15), // 15 ก.ค. 2026 → เหลือ 6 เดือน
                isActive: true,
            });

            await api.generateEntitlements({ year: 2026 });
            const created = await Employee.findOne({ where: { idCard: '9100000000001' } });
            const res = await api.getEntitlements({ employeeId: created.id, year: 2026 });
            const byName = Object.fromEntries(res.body.data.map((b) => [b.leaveTypeName, b]));

            // ลาป่วย 30×6/12 = 15 | พักร้อน 7×6/12 = 3.5 → ปัดขึ้น 4 | ลากิจ 3×6/12 = 1.5 → 2
            expect(byName['ลาป่วย'].entitledDays).toBe(15);
            expect(byName['พักร้อน'].entitledDays).toBe(4);
            expect(byName['ลากิจ'].entitledDays).toBe(2);
        });

        it('should allow patching entitledDays below used (ยอดติดลบได้)', async () => {
            await api.generateEntitlements({ year: 2026 });
            const emp = seed.employees[0];
            const res = await api.getEntitlements({ employeeId: emp.id, year: 2026 });
            const tiny = res.body.data.find((b) => b.leaveTypeName === 'เทสจิ๋ว');

            const leave = await api.createLeave({
                employeeId: emp.id, leaveTypeId: tiny.leaveTypeId,
                date: '2026-03-10', timeIn: '08:00', timeOut: '12:00', createBy: user.id,
            });
            expect(leave.status).toBe(201);

            const patch = await api.updateEntitlement(tiny.id, { entitledDays: 0 });
            expect(patch.status).toBe(200);

            const after = await api.getEntitlements({ employeeId: emp.id, year: 2026 });
            const tinyAfter = after.body.data.find((b) => b.leaveTypeName === 'เทสจิ๋ว');
            // ใช้ไป 240 นาที สิทธิ์ 0 วัน → เหลือ -240
            expect(tinyAfter.remainingMinutes).toBe(-240);
        });
    });

    describe('leaves: happy path + balance', () => {
        it('should create full-day leave (08:00-17:00 = 480 นาที หลังหักพัก) and reflect balance', async () => {
            await api.generateEntitlements({ year: 2026 });
            const emp = seed.employees[0];
            const sick = await typeByName('ลาป่วย');

            const res = await api.createLeave({
                employeeId: emp.id, leaveTypeId: sick.id,
                date: '2026-03-10', timeIn: '08:00', timeOut: '17:00', createBy: user.id,
            });
            expect(res.status).toBe(201);

            const bal = await api.getEntitlements({ employeeId: emp.id, year: 2026 });
            const sickBal = bal.body.data.find((b) => b.leaveTypeName === 'ลาป่วย');
            expect(sickBal.usedMinutes).toBe(480);
            expect(sickBal.remainingMinutes).toBe(30 * 480 - 480);
        });

        it('should restore balance after delete', async () => {
            await api.generateEntitlements({ year: 2026 });
            const emp = seed.employees[0];
            const sick = await typeByName('ลาป่วย');

            const created = await api.createLeave({
                employeeId: emp.id, leaveTypeId: sick.id,
                date: '2026-03-10', timeIn: '08:00', timeOut: '12:00', createBy: user.id,
            });
            await api.deleteLeave(created.body.data.id);

            const bal = await api.getEntitlements({ employeeId: emp.id, year: 2026 });
            const sickBal = bal.body.data.find((b) => b.leaveTypeName === 'ลาป่วย');
            expect(sickBal.usedMinutes).toBe(0);
        });
    });

    describe('leaves: validation 7 ข้อตาม spec section B', () => {
        it('1a. should 404 unknown employee / leaveType', async () => {
            await api.generateEntitlements({ year: 2026 });
            const sick = await typeByName('ลาป่วย');
            const badEmp = await api.createLeave({
                employeeId: 9999, leaveTypeId: sick.id,
                date: '2026-03-10', timeIn: '08:00', timeOut: '17:00',
            });
            expect(badEmp.status).toBe(404);

            const badType = await api.createLeave({
                employeeId: seed.employees[0].id, leaveTypeId: 9999,
                date: '2026-03-10', timeIn: '08:00', timeOut: '17:00',
            });
            expect(badType.status).toBe(404);
        });

        it('1b. should reject inactive leaveType', async () => {
            const sick = await typeByName('ลาป่วย');
            await api.updateLeaveType(sick.id, { isActive: false });
            const res = await api.createLeave({
                employeeId: seed.employees[0].id, leaveTypeId: sick.id,
                date: '2026-03-10', timeIn: '08:00', timeOut: '17:00',
            });
            expect(res.status).toBe(422);
        });

        it('1c. should reject timeIn >= timeOut', async () => {
            const emp = seed.employees[0];
            const sick = await typeByName('ลาป่วย');
            const res = await api.createLeave({
                employeeId: emp.id, leaveTypeId: sick.id,
                date: '2026-03-10', timeIn: '12:00', timeOut: '12:00',
            });
            expect(res.status).toBe(422);
        });

        it('2. should reject out-of-window leave for REGULAR employee but allow 24h for SHIFT', async () => {
            const emp = seed.employees[0];
            const sick = await typeByName('ลาป่วย');
            await api.generateEntitlements({ year: 2026 });

            const early = await api.createLeave({
                employeeId: emp.id, leaveTypeId: sick.id,
                date: '2026-03-10', timeIn: '05:00', timeOut: '10:00',
            });
            expect(early.status).toBe(422);
            expect(early.body.error.message).toContain('08:00–17:00');

            // พนักงานกะลาได้นอก 08:00–17:00 (เวลาสั้นกว่าพัก ไม่โดนหัก)
            const shiftEmp = await Employee.create({
                firstName: 'กะ', lastName: 'Test',
                idCard: '9200000000001', shiftType: 'SHIFT',
                workLeaderId: seed.workLeader.id,
                startDate: new Date(2025, 0, 1), isActive: true,
            });
            await api.generateEntitlements({ year: 2026 });
            const ok = await api.createLeave({
                employeeId: shiftEmp.id, leaveTypeId: sick.id,
                date: '2026-03-10', timeIn: '05:00', timeOut: '09:00', createBy: user.id,
            });
            expect(ok.status).toBe(201);
        });

        it('3. should reject leave on public holiday', async () => {
            await api.createHoliday({ date: '2026-03-10', name: 'วันทดสอบ' });
            const emp = seed.employees[0];
            const sick = await typeByName('ลาป่วย');
            await api.generateEntitlements({ year: 2026 });

            const res = await api.createLeave({
                employeeId: emp.id, leaveTypeId: sick.id,
                date: '2026-03-10', timeIn: '08:00', timeOut: '17:00',
            });
            expect(res.status).toBe(422);
            expect(res.body.error.message).toContain('นักขัตฤกษ์');
        });

        it('4. should reject overlapping leave records (409)', async () => {
            const emp = seed.employees[0];
            const sick = await typeByName('ลาป่วย');
            await api.generateEntitlements({ year: 2026 });

            const first = await api.createLeave({
                employeeId: emp.id, leaveTypeId: sick.id,
                date: '2026-03-10', timeIn: '08:00', timeOut: '12:00', createBy: user.id,
            });
            expect(first.status).toBe(201);

            const overlap = await api.createLeave({
                employeeId: emp.id, leaveTypeId: sick.id,
                date: '2026-03-10', timeIn: '11:00', timeOut: '15:00',
            });
            expect(overlap.status).toBe(409);

            // ต่อกันได้ (12:00 เริ่มหลัง 12:00 เลิก — ไม่ซ้อน)
            const adjacent = await api.createLeave({
                employeeId: emp.id, leaveTypeId: sick.id,
                date: '2026-03-10', timeIn: '13:00', timeOut: '17:00', createBy: user.id,
            });
            expect(adjacent.status).toBe(201);
        });

        it('5. should reject leave overlapping with TimeEntry (409)', async () => {
            const emp = seed.employees[0];
            const sick = await typeByName('ลาป่วย');
            await api.generateEntitlements({ year: 2026 });
            await createEntry(emp.id, '2026-03-10', '08:00', '15:00');

            const res = await api.createLeave({
                employeeId: emp.id, leaveTypeId: sick.id,
                date: '2026-03-10', timeIn: '14:00', timeOut: '17:00',
            });
            expect(res.status).toBe(409);
            expect(res.body.error.message).toContain('เวลาทำงาน');
        });

        it('6. should reject work+leave > 480 min/day (พนักงานกะ) — ส่วนเกินต้องเป็น OT', async () => {
            const sick = await typeByName('ลาป่วย');
            // พนักงานปกติ (08:00–17:00) รวม work+leave ไม่ซ้อนทับไม่พ้น 480 ทางโครงสร้าง —
            // กติกานี้จึงมีผลจริงกับพนักงานกะ (ทำงานกลางคืน + ลากลางวัน = เกิน 1 วัน)
            const createShiftEmp = (idCard, firstName) => Employee.create({
                firstName, lastName: 'Test',
                idCard, shiftType: 'SHIFT',
                workLeaderId: seed.workLeader.id,
                startDate: new Date(2025, 0, 1), isActive: true,
            });
            const shiftEmp = await createShiftEmp('9300000000001', 'กะ2');
            const shiftEmp2 = await createShiftEmp('9300000000002', 'กะ3');
            await api.generateEntitlements({ year: 2026 });

            // กะดึก 22:00-06:00 = 480 นาที (คร่อมวัน ชดเชย 24 ชม.) + ลาเช้า 08:00-12:00 = 240 → 720 > 480
            await createEntry(shiftEmp.id, '2026-03-10', '22:00', '06:00');

            const res = await api.createLeave({
                employeeId: shiftEmp.id, leaveTypeId: sick.id,
                date: '2026-03-10', timeIn: '08:00', timeOut: '12:00',
            });
            expect(res.status).toBe(422);
            expect(res.body.error.message).toContain('8 ชม.');

            // ขอบเขตพอดี: กะดึก 22:00-02:00 = 240 + ลา 08:00-12:00 = 240 → 480 → ผ่าน
            await createEntry(shiftEmp2.id, '2026-03-10', '22:00', '02:00');
            const exact = await api.createLeave({
                employeeId: shiftEmp2.id, leaveTypeId: sick.id,
                date: '2026-03-10', timeIn: '08:00', timeOut: '12:00', createBy: user.id,
            });
            expect(exact.status).toBe(201);
        });

        it('7. should block leave beyond remaining entitlement + ต้องมีสิทธิ์ก่อน', async () => {
            const emp = seed.employees[0];
            const tiny = await typeByName('เทสจิ๋ว');

            // ปีที่ยังไม่ generate → ไม่มีสิทธิ์ → ลาไม่ได้
            const noEnt = await api.createLeave({
                employeeId: emp.id, leaveTypeId: tiny.id,
                date: '2026-03-10', timeIn: '08:00', timeOut: '12:00',
            });
            expect(noEnt.status).toBe(422);
            expect(noEnt.body.error.message).toContain('generate');

            await api.generateEntitlements({ year: 2026 });

            // สิทธิ์จิ๋ว = 1 วัน — ลาเต็มวันได้พอดี
            const full = await api.createLeave({
                employeeId: emp.id, leaveTypeId: tiny.id,
                date: '2026-03-10', timeIn: '08:00', timeOut: '17:00', createBy: user.id,
            });
            expect(full.status).toBe(201);

            // วันถัดไปลาอีก → เกินสิทธิ์ → block
            const over = await api.createLeave({
                employeeId: emp.id, leaveTypeId: tiny.id,
                date: '2026-03-11', timeIn: '08:00', timeOut: '12:00',
            });
            expect(over.status).toBe(422);
            expect(over.body.error.message).toContain('สิทธิ์คงเหลือไม่พอ');
        });
    });
});

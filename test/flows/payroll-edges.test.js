import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { cleanDatabase, disconnectPrisma } from '../helpers/db.js';
import { createTestAuth } from '../helpers/auth.js';
import { seedTestData } from '../helpers/seed.js';
import { createApiClient } from '../helpers/client.js';
import IORedis from 'ioredis';

// เงื่อนไขขอบ (edges) ของรอบจ่าย/ยอดจ่าย
// - รอบจ่ายซ้ำ → 409 (err.conflict จาก pay-period.service.createPayPeriod)
// - endDate ≤ startDate → 422 (Joi endDate.greater(ref) ใน pay-period.controller)
// - cancelAllPayrolls → payroll CANCELLED + time entry กลับ DRAFT + paidValue null
// - payRef ลำดับ PAY-{year}-{periodNo 2หลัก}-{seq 3หลัก} (จาก _generatePayRef)
// - getPayrolls กรองตาม payPeriodId + status
describe('Payroll Edges — เงื่อนไขขอบของรอบจ่ายและยอดจ่าย', () => {
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

    // สร้าง worker sheet วันเดียวให้ count คนแรกใน seed + FILLED (08:00–17:00 → วันเต็ม 500)
    async function fillSheetFor(employees, workDate = '2025-06-02') {
        const res = await api.createWorkerTimeSheet({
            workLeaderId: seed.workLeader.id,
            workDate,
            pattern: { regular: true, ot: 0 },
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
        return res.body.data;
    }

    it('สร้างรอบจ่ายซ้ำ (year+periodNo+employeeType เดิม) → 409 Conflict', async () => {
        const body = {
            periodNo: 1,
            year: 2025,
            employeeType: 'WORKER',
            startDate: '2025-06-01',
            endDate: '2025-06-15',
        };
        const first = await api.createPayPeriod(body);
        expect(first.status).toBe(201);

        const dup = await api.createPayPeriod(body);
        expect(dup.status).toBe(409);
        expect(dup.body.error.code).toBe('CONFLICT');

        // unique key รวม employeeType — ปี+เลขรอบเดิมแต่คนละประเภทต้องสร้างได้
        const otherType = await api.createPayPeriod({ ...body, employeeType: 'DRIVER' });
        expect(otherType.status).toBe(201);
    });

    it('endDate ≤ startDate → 422 Validation Error', async () => {
        // endDate = startDate (Joi greater ไม่รับค่าเท่ากัน)
        const equal = await api.createPayPeriod({
            periodNo: 2,
            year: 2025,
            employeeType: 'WORKER',
            startDate: '2025-06-10',
            endDate: '2025-06-10',
        });
        expect(equal.status).toBe(422);
        expect(equal.body.error.code).toBe('VALIDATION_ERROR');

        // endDate < startDate
        const before = await api.createPayPeriod({
            periodNo: 3,
            year: 2025,
            employeeType: 'WORKER',
            startDate: '2025-06-15',
            endDate: '2025-06-01',
        });
        expect(before.status).toBe(422);
    });

    it('cancelAllPayrolls: ทุก payroll → CANCELLED, time entry → DRAFT + paidValue null', async () => {
        const periodRes = await api.createPayPeriod({
            periodNo: 1,
            year: 2025,
            employeeType: 'WORKER',
            startDate: '2025-06-01',
            endDate: '2025-06-15',
        });
        const periodId = periodRes.body.data.id;

        const sheet = await fillSheetFor(seed.employees.slice(0, 2));
        const createRes = await api.createPayrolls(periodId);
        expect(createRes.status).toBe(201);
        expect(createRes.body.created).toBe(2);

        // ก่อนยกเลิก: entries LOCKED พร้อม paidValue (08:00–17:00 = 480 effective → 500)
        const before = await api.getTimesheetById(sheet.id);
        expect(before.body.data.timeEntries).toHaveLength(2);
        for (const entry of before.body.data.timeEntries) {
            expect(entry.status).toBe('LOCKED');
            expect(Number(entry.paidValue)).toBe(500);
        }

        const cancelRes = await api.cancelAllPayrolls(periodId);
        expect(cancelRes.status).toBe(200);
        expect(cancelRes.body.cancelled).toBe(2);

        // time entries กลับ DRAFT + paidValue null
        const after = await api.getTimesheetById(sheet.id);
        for (const entry of after.body.data.timeEntries) {
            expect(entry.status).toBe('DRAFT');
            expect(entry.paidValue).toBeNull();
        }

        // getPayPeriodById กรอง CANCELLED ออก → payrolls ว่าง
        const detail = await api.getPayPeriodById(periodId);
        expect(detail.body.data.payrolls).toHaveLength(0);

        // แต่ยังต้องเจอได้จาก getPayrolls กรอง status = CANCELLED
        const list = await api.getPayrolls({ payPeriodId: periodId, status: 'CANCELLED', limit: 10 });
        expect(list.body.pagination.total).toBe(2);
        for (const p of list.body.data) {
            expect(p.status).toBe('CANCELLED');
        }
    });

    it('payRef ลำดับ: PAY-{year}-{periodNo 2หลัก}-{seq 3หลัก} เรียงตามลำดับสร้าง', async () => {
        const periodRes = await api.createPayPeriod({
            periodNo: 3, // ทดสอบเติมศูนย์หน้าเป็น 2 หลัก
            year: 2025,
            employeeType: 'WORKER',
            startDate: '2025-06-01',
            endDate: '2025-06-15',
        });
        const periodId = periodRes.body.data.id;

        await fillSheetFor(seed.employees.slice(0, 3));
        const createRes = await api.createPayrolls(periodId);
        expect(createRes.status).toBe(201);
        expect(createRes.body.created).toBe(3);

        // seq เริ่มจาก Payroll.count(payPeriodId) = 0 แล้ว +1 ทุกคนที่สร้าง
        // → PAY-2025-03-001/002/003 (payroll id สร้างตามลำดับ seq จึงเรียงตรงกัน)
        const list = await api.getPayrolls({ payPeriodId: periodId, sortBy: 'id', sort: 'asc', limit: 10 });
        const refs = list.body.data.map((p) => p.payRef);
        expect(refs).toEqual(['PAY-2025-03-001', 'PAY-2025-03-002', 'PAY-2025-03-003']);
        expect(new Set(refs).size).toBe(3); // unique (มี unique index บน pay_ref)
    });

    it('getPayrolls กรองตาม payPeriodId + status', async () => {
        // รอบ A มี 2 ยอด, รอบ B ว่าง
        const periodA = (await api.createPayPeriod({
            periodNo: 1, year: 2025, employeeType: 'WORKER',
            startDate: '2025-06-01', endDate: '2025-06-15',
        })).body.data.id;
        const periodB = (await api.createPayPeriod({
            periodNo: 2, year: 2025, employeeType: 'WORKER',
            startDate: '2025-06-16', endDate: '2025-06-30',
        })).body.data.id;

        await fillSheetFor(seed.employees.slice(0, 2));
        const createRes = await api.createPayrolls(periodA);
        expect(createRes.body.created).toBe(2);

        // กรองตาม payPeriodId
        expect((await api.getPayrolls({ payPeriodId: periodA, limit: 10 })).body.pagination.total).toBe(2);
        expect((await api.getPayrolls({ payPeriodId: periodB, limit: 10 })).body.pagination.total).toBe(0);

        // กรอง payPeriodId + status: หลังสร้างเป็น PENDING ทั้งหมด
        const pending = await api.getPayrolls({ payPeriodId: periodA, status: 'PENDING', limit: 10 });
        expect(pending.body.pagination.total).toBe(2);
        for (const p of pending.body.data) {
            expect(p.status).toBe('PENDING');
        }

        // export แล้ว PENDING → 0, CALCULATED → 2
        const exportRes = await api.exportPeriod(periodA);
        expect(exportRes.status).toBe(200);
        expect((await api.getPayrolls({ payPeriodId: periodA, status: 'PENDING', limit: 10 })).body.pagination.total).toBe(0);
        const calculated = await api.getPayrolls({ payPeriodId: periodA, status: 'CALCULATED', limit: 10 });
        expect(calculated.body.pagination.total).toBe(2);
        for (const p of calculated.body.data) {
            expect(p.status).toBe('CALCULATED');
        }
    });
});

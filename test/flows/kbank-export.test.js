import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import ExcelJS from 'exceljs';
import { cleanDatabase, disconnectPrisma } from '../helpers/db.js';
import { createTestAuth } from '../helpers/auth.js';
import { seedTestData } from '../helpers/seed.js';
import { createApiClient } from '../helpers/client.js';
import IORedis from 'ioredis';

// Export รอบจ่ายออกเป็นไฟล์ .xlsx 4 คอลัมน์ตาม sheet Transaction ของ
// KBank_Excel Template_V2.6.1.xlsm (ทีม copy ไปวางที่คอลัมน์ D–G แถว 8)
//   D เลขบัญชี (text เสมอ — ขึ้นต้น 0 ต้องไม่หาย) | E ชื่อ (ไม่มีคำนำหน้า)
//   F ยอด netPay | G Bene Ref = payroll.payRef (PAY-YYYY-PP-NNN)
// คนที่ไม่มีเลขบัญชี → ออกแถวด้วย แต่ช่องบัญชีว่าง
describe('Export KBank Transaction file', () => {
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

    // ลงเวลาวันเต็ม 1 คน (08:00–17:00 REGULAR → 480 effective → paidValue = dailyRate)
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

    async function exportToSheet(periodId) {
        const res = await api.exportPeriod(periodId).responseType('blob');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(res.body);
        return workbook.getWorksheet('Transaction');
    }

    it('ออกไฟล์ 4 คอลัมน์ D–G ตาม template + flip PENDING → CALCULATED', async () => {
        // คน 1: บัญชีขึ้นต้น 0 / คน 2: ไม่มีเลขบัญชี
        await seed.employees[0].update({ bankAccount: '0908630092' });
        await seed.employees[1].update({ bankAccount: null });

        const periodRes = await api.createPayPeriod({
            periodNo: 2,
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

        // ยอด/ชื่ออ้างอิงจาก GET /pay-periods/:id ตรง ๆ — ไม่ hardcode
        const detail = (await api.getPayPeriodById(periodId)).body.data;
        const bankByEmployee = new Map([
            [seed.employees[0].id, '0908630092'],
            [seed.employees[1].id, ''],
        ]);

        const sheet = await exportToSheet(periodId);

        // header แถว 1 = 4 หัวคอลัมน์เดียวกับ template
        expect(sheet.getRow(1).getCell(1).value).toBe('เลขที่บัญชี\nAccount Number');
        expect(sheet.getRow(1).getCell(2).value).toBe('ชื่อผู้รับเงิน\nVendor Name');
        expect(sheet.getRow(1).getCell(3).value).toBe('จำนวนเงิน\nAmount');
        expect(sheet.getRow(1).getCell(4).value).toBe('เลขที่อ้างอิงรายการ\nBene Ref');
        expect(sheet.rowCount).toBe(3); // header + 2 แถว

        // แถวข้อมูลตามลำดับ payroll เดียวกับ GET /pay-periods/:id
        expect(detail.payrolls).toHaveLength(2);
        detail.payrolls.forEach((payroll, i) => {
            const row = sheet.getRow(i + 2);
            const accountCell = row.getCell(1);
            expect(accountCell.value).toBe(bankByEmployee.get(payroll.employeeId));
            // บัญชีเป็น text เสมอ — ไม่ให้ Excel กลืนเลข 0 นำหน้า
            expect(accountCell.type).toBe(ExcelJS.ValueType.String);
            expect(row.getCell(2).value).toBe(
                `${payroll.employee.firstName} ${payroll.employee.lastName}`,
            );
            expect(row.getCell(3).value).toBe(payroll.summary.netPay);
            // Bene Ref = payRef — ใช้จับคู่ตอน import ไฟล์ผลโอนกลับมา mark PAID
            expect(row.getCell(4).value).toBe(payroll.payRef);
        });

        // export แล้ว payroll PENDING → CALCULATED (period ยัง OPEN)
        const after = (await api.getPayPeriodById(periodId)).body.data;
        expect(after.status).toBe('OPEN');
        expect(after.payrolls.every((p) => p.status === 'CALCULATED')).toBe(true);
    });

    it('period ปิดแล้ว → 400 ไม่มีไฟล์ออก', async () => {
        const periodRes = await api.createPayPeriod({
            periodNo: 1,
            year: 2026,
            employeeType: 'WORKER',
            startDate: '2026-10-01',
            endDate: '2026-10-15',
        });
        const periodId = periodRes.body.data.id;

        // ไม่มี PENDING ค้าง → ปิดรอบได้เลย
        const closeRes = await api.closePeriod(periodId);
        expect(closeRes.status).toBe(200);

        const res = await api.exportPeriod(periodId);
        expect(res.status).toBe(400);
        expect(res.body.error.message).toContain('ไม่อยู่ในสถานะเปิด');
    });

    it('ไม่พบรอบจ่าย → 404', async () => {
        const res = await api.exportPeriod(99999);
        expect(res.status).toBe(404);
    });
});

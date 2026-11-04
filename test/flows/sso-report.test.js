import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import ExcelJS from 'exceljs';
import { cleanDatabase, disconnectPrisma } from '../helpers/db.js';
import { createTestAuth } from '../helpers/auth.js';
import { seedTestData } from '../helpers/seed.js';
import { createApiClient } from '../helpers/client.js';
import { Payroll, WageRate } from '../../src/database/index.js';
import IORedis from 'ioredis';

// รายงานนำส่งประกันสังคมรายเดือน (docs/SSO-PLAN.md)
// - เฉพาะ payroll PAID, จับกลุ่ม period ตามเดือนของ endDate (WORKER 2 รอบรวมกัน)
// - ฐานค่าจ้างคำนวณสด / ยอดเรียกเก็บ = ssoAmount จริง / สมทบ = ลูกจ้าง / รวม = ×2
describe('SSO Report — รายงานนำส่งรายเดือน + export xlsx', () => {
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

    async function fillSheet(employee, workDate) {
        const res = await api.createWorkerTimeSheet({
            workLeaderId: seed.workLeader.id,
            workDate,
            pattern: { regular: true, ot: 0 },
            entries: [{ employeeId: employee.id, timeIn: '08:00:00', timeOut: '17:00:00', shiftType: 'REGULAR' }],
        });
        expect(res.status).toBe(201);
        const fill = await api.updateTimeSheet(res.body.data.id, { status: 'FILLED' });
        expect(fill.status).toBe(200);
    }

    // สร้าง worker B (700/วัน) 2 รอบใน มิ.ย. 2025 แล้วตั้ง PAID
    async function setupPaidWorkerJune() {
        await api.createSsoConfig({ effectiveFrom: '2020-01-01', effectiveTo: null, ratePercent: 5, maxWage: 17500 });
        const b = seed.employees[1];
        await WageRate.update({ dailyRate: 700 }, { where: { employeeId: b.id } });

        const p1 = await api.createPayPeriod({
            periodNo: 1, year: 2025, employeeType: 'WORKER', startDate: '2025-06-01', endDate: '2025-06-14',
        });
        for (let d = 1; d <= 14; d++) await fillSheet(b, `2025-06-${String(d).padStart(2, '0')}`);
        await api.createPayrolls(p1.body.data.id);

        const p2 = await api.createPayPeriod({
            periodNo: 2, year: 2025, employeeType: 'WORKER', startDate: '2025-06-15', endDate: '2025-06-30',
        });
        for (let d = 15; d <= 27; d++) await fillSheet(b, `2025-06-${String(d).padStart(2, '0')}`);
        await api.createPayrolls(p2.body.data.id);

        await Payroll.update({ status: 'PAID' }, { where: { payPeriodId: [p1.body.data.id, p2.body.data.id] } });
        return { b, p1, p2 };
    }

    it('เฉพาะ PAID — ก่อนตั้งสถานะยัง PENDING ต้องไม่โผล่ในรายงาน', async () => {
        await api.createSsoConfig({ effectiveFrom: '2020-01-01', effectiveTo: null, ratePercent: 5, maxWage: 17500 });
        const b = seed.employees[0];
        await fillSheet(b, '2025-06-02');
        const period = await api.createPayPeriod({
            periodNo: 1, year: 2025, employeeType: 'WORKER', startDate: '2025-06-01', endDate: '2025-06-15',
        });
        await api.createPayrolls(period.body.data.id);

        const res = await api.getSsoReport({ month: 6, year: 2025 });
        expect(res.status).toBe(200);
        expect(res.body.data.rows).toEqual([]);
        expect(res.body.data.summary.total).toBe(0);

        await Payroll.update({ status: 'PAID' }, { where: { payPeriodId: period.body.data.id } });
        const after = await api.getSsoReport({ month: 6, year: 2025 });
        expect(after.body.data.rows).toHaveLength(1);
    });

    it('รวม WORKER 2 รอบของเดือนเดียวกัน — ฐานรวม + ยอดเรียกเก็บรวมถึงเพดาน', async () => {
        await setupPaidWorkerJune();

        const res = await api.getSsoReport({ month: 6, year: 2025 });
        expect(res.status).toBe(200);

        expect(res.body.data.rows).toHaveLength(1);
        const row = res.body.data.rows[0];
        expect(row.employeeType).toBe('WORKER');
        expect(row.idCard).toBe(seed.employees[1].idCard);
        expect(row.base).toBe(18900);            // 9,800 + 9,100
        expect(row.employeeAmount).toBe(875);    // 490 + 385 (ครบเพดาน)
        expect(res.body.data.summary).toEqual({
            base: 18900,
            employeeAmount: 875,
            employerAmount: 875,
            total: 1750,
        });
    });

    it('เดือนที่ไม่มีข้อมูล → rows ว่าง + summary ศูนย์', async () => {
        const res = await api.getSsoReport({ month: 3, year: 2025 });
        expect(res.status).toBe(200);
        expect(res.body.data.rows).toEqual([]);
        expect(res.body.data.summary.total).toBe(0);
    });

    it('ต้อง validate month/year — 422', async () => {
        expect((await api.getSsoReport({ month: 13, year: 2025 })).status).toBe(422);
        expect((await api.getSsoReport({ month: 6 })).status).toBe(422);
    });

    it('payroll ที่สร้างตอนไม่มี config (ssoBase null) → มี warning แจ้ง', async () => {
        const b = seed.employees[0];
        await fillSheet(b, '2025-06-02');
        const period = await api.createPayPeriod({
            periodNo: 1, year: 2025, employeeType: 'WORKER', startDate: '2025-06-01', endDate: '2025-06-15',
        });
        await api.createPayrolls(period.body.data.id);
        await Payroll.update({ status: 'PAID' }, { where: { payPeriodId: period.body.data.id } });

        const res = await api.getSsoReport({ month: 6, year: 2025 });
        expect(res.body.data.warnings).toHaveLength(1);
        expect(res.body.data.warnings[0]).toContain('SSO');
    });

    it('export xlsx — เลขบัตรเป็น text, มีแถวรวม bold, ค่าตรงกับ report', async () => {
        await setupPaidWorkerJune();

        const res = await api.exportSsoReport({ month: 6, year: 2025 }).responseType('blob');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('spreadsheetml');
        expect(res.headers['content-disposition']).toContain('sso_report_2025-06.xlsx');

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(res.body);
        const sheet = workbook.getWorksheet('SSO');
        expect(sheet.rowCount).toBe(3);          // header + 1 แถว + รวม

        const header = sheet.getRow(1).values;
        expect(header).toContain('เลขบัตรประชาชน');
        expect(header).toContain('ยอดเรียกเก็บลูกจ้าง');

        const dataRow = sheet.getRow(2);
        expect(dataRow.getCell(1).value).toBe('คนงาน');
        expect(typeof dataRow.getCell(2).value).toBe('string');          // text กันหาย 0
        expect(dataRow.getCell(2).value).toBe(seed.employees[1].idCard);
        expect(dataRow.getCell(4).value).toBe(18900);
        expect(dataRow.getCell(5).value).toBe(875);

        const totalRow = sheet.getRow(3);
        expect(totalRow.getCell(1).value).toBe('รวม');
        expect(totalRow.getCell(7).value).toBe(1750);
        expect(totalRow.font.bold).toBe(true);
    });
});

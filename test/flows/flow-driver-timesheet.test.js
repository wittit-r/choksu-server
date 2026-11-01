import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { cleanDatabase, disconnectPrisma } from '../helpers/db.js';
import { createTestAuth } from '../helpers/auth.js';
import { seedTestData } from '../helpers/seed.js';
import { createApiClient } from '../helpers/client.js';
import { Position, Employee, WageRate } from '../../src/database/index.js';
import IORedis from 'ioredis';

// Flow: คนขับรถ — ใบลงเวลารายเดือน (MONTHLY) → FILLED → สร้างรอบจ่ายประเภท DRIVER → ยอดถูกต้อง
describe('Flow: Driver — ลงเวลารายเดือนและจ่ายเงิน', () => {
    let redis, api, seed, driver;

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

        // เตรียมข้อมูลฝั่ง DRIVER (seed หลักมีแต่ WORKER)
        const driverPosition = await Position.create({
            name: 'Test Driver',
            code: 'TD',
            employeeType: 'DRIVER',
            isActive: true,
        });
        const driverEmployee = await Employee.create({
            firstName: 'DRIVER',
            lastName: 'TEST',
            idCard: '9999999999999',
            bankAccount: '9999999999',
            shiftType: 'REGULAR',
            workLeaderId: seed.workLeader.id,
            startDate: new Date('2026-01-01'),
            isActive: true,
        });
        await WageRate.create({
            employeeId: driverEmployee.id,
            positionId: driverPosition.id,
            dailyRate: 500,
            hourlyRate: 62.5,
            minuteRate: 1.042,
            monthlyRate: 0,
            effectiveFrom: new Date('2026-01-01'),
        });
        driver = { position: driverPosition, employee: driverEmployee };
    });

    afterAll(async () => {
        await redis.quit();
        await disconnectPrisma();
    });

    it('สร้างใบลงเวลารายเดือน → FILLED → รอบจ่าย DRIVER → ยอดถูกต้อง', async () => {
        // 1. สร้างใบลงเวลาคนขับ (รายเดือน)
        const sheetRes = await api.createDriverTimeSheet({
            employeeId: driver.employee.id,
            monthPeriod: '2026-11',
            allowDuplicate: false,
            entries: [
                { date: '2026-11-02', timeIn: '08:00:00', timeOut: '17:00:00', workType: 'REGULAR', otRate: 0, accommodation: 0 },
                { date: '2026-11-03', timeIn: '08:00:00', timeOut: '17:00:00', workType: 'REGULAR', otRate: 0, accommodation: 0 },
                // ค่าที่พัก (ไม่มีเวลา)
                { date: '2026-11-02', timeIn: null, timeOut: null, workType: 'ACCOMMODATION', otRate: 0, accommodation: 300 },
            ],
        });
        expect(sheetRes.status).toBe(201);
        const sheet = sheetRes.body.data;
        expect(sheet.timeEntries).toHaveLength(3);

        // 2. เปลี่ยนสถานะเป็ FILLED
        await api.updateTimeSheet(sheet.id, { status: 'FILLED' });

        // 3. สร้างรอบจ่ายประเภท DRIVER
        const periodRes = await api.createPayPeriod({
            periodNo: 1,
            year: 2026,
            employeeType: 'DRIVER',
            startDate: '2026-11-01',
            endDate: '2026-11-15',
        });
        expect(periodRes.status).toBe(201);
        const periodId = periodRes.body.data.id;

        // 4. สร้างยอดจ่าย
        const payrollRes = await api.createPayrolls(periodId);
        expect(payrollRes.status).toBe(201);
        expect(payrollRes.body.created).toBe(1);

        // 5. ตรวจยอด: งานปกติ 2 วัน (หักพักกลางวัน 480 นาที/วัน) + ค่าที่พัก 300
        const detailRes = await api.getPayPeriodById(periodId);
        expect(detailRes.status).toBe(200);
        const p = detailRes.body.data.payrolls[0];
        expect(p.summary.regularAmount).toBe(1000);
        expect(p.summary.accommodationAmount).toBe(300);
        expect(p.summary.workingDays).toBe(2);
        expect(p.summary.netPay).toBe(1300);
    });
});

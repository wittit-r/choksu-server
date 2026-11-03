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
            monthlyRate: 15000,
            effectiveFrom: new Date('2026-01-01'),
        });
        driver = { position: driverPosition, employee: driverEmployee };
    });

    afterAll(async () => {
        await redis.quit();
        await disconnectPrisma();
    });

    it('สร้างใบลงเวลารายเดือน → FILLED → รอบจ่าย DRIVER → ยอดถูกต้อง', async () => {
        // พ.ย. 2026: อาทิตย์ 5 วัน (1,8,15,22,29) → วัน จ–ส 25 วัน — ลงครบทุกวัน + ค่าที่พัก 1 คืน
        const entries = [];
        for (let d = 2; d <= 30; d++) {
            const date = new Date(2026, 10, d);
            if (date.getDay() === 0) continue;
            entries.push({
                date: `2026-11-${String(d).padStart(2, '0')}`,
                timeIn: '08:00:00', timeOut: '17:00:00',
                workType: 'REGULAR', otRate: 0, accommodation: 0,
            });
        }
        entries.push({ date: '2026-11-02', timeIn: null, timeOut: null, workType: 'ACCOMMODATION', otRate: 0, accommodation: 300 });

        // 1. สร้างใบลงเวลาคนขับ (รายเดือน)
        const sheetRes = await api.createDriverTimeSheet({
            employeeId: driver.employee.id,
            monthPeriod: '2026-11',
            allowDuplicate: false,
            entries,
        });
        expect(sheetRes.status).toBe(201);
        const sheet = sheetRes.body.data;
        expect(sheet.timeEntries).toHaveLength(26);

        // 2. เปลี่ยนสถานะเป็น FILLED
        await api.updateTimeSheet(sheet.id, { status: 'FILLED' });

        // 3. สร้างรอบจ่ายประเภท DRIVER (รายเดือนเต็มเดือน)
        const periodRes = await api.createPayPeriod({
            periodNo: 11,
            year: 2026,
            employeeType: 'DRIVER',
            startDate: '2026-11-01',
            endDate: '2026-11-30',
        });
        expect(periodRes.status).toBe(201);
        const periodId = periodRes.body.data.id;

        // 4. สร้างยอดจ่าย
        const payrollRes = await api.createPayrolls(periodId);
        expect(payrollRes.status).toBe(201);
        expect(payrollRes.body.created).toBe(1);

        // 5. ตรวจยอด (สูตรใหม่ spec section D): มาครบทุกวัน จ–ส → ไม่ขาด
        //    basePay = monthlyRate 15,000 + ค่าที่พัก 300 → netPay 15,300
        const detailRes = await api.getPayPeriodById(periodId);
        expect(detailRes.status).toBe(200);
        const p = detailRes.body.data.payrolls[0];
        expect(p.summary.payMode).toBe('MONTHLY');
        expect(p.summary.monthlyRate).toBe(15000);
        expect(p.summary.absentMinutes).toBe(0);
        expect(p.summary.absenceDeduction).toBe(0);
        expect(p.summary.basePay).toBe(15000);
        expect(p.summary.regularAmount).toBe(15000);
        expect(p.summary.accommodationAmount).toBe(300);
        expect(p.summary.workingDays).toBe(25);
        expect(p.summary.netPay).toBe(15300);
    });
});

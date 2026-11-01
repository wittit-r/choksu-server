import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { cleanDatabase, disconnectPrisma } from '../helpers/db.js';
import { createTestAuth } from '../helpers/auth.js';
import { seedTestData } from '../helpers/seed.js';
import { createApiClient } from '../helpers/client.js';
import prisma from '../../src/databases/prisma.js';
import IORedis from 'ioredis';

describe('Flow 9: Retro — อัตราค่าจ้างเปลี่ยนกลางสัญญา', () => {
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

    it('should create retro time entries when wage rate changes and paidDate is set', async () => {
        const employeeId = seed.employees[0].id;

        // Step 1: สร้างรอบจ่ายรอบที่ 1 + timesheet + payroll
        const period1Res = await api.createPayPeriod({
            periodNo: 1,
            year: 2025,
            employeeType: 'WORKER',
            startDate: '2025-06-01',
            endDate: '2025-06-15',
        });
        const period1Id = period1Res.body.data.id;

        const sheetRes = await api.createWorkerTimeSheet({
            workLeaderId: seed.workLeader.id,
            workDate: '2025-06-02',
            pattern: { regular: true, ot: 0 },
            entries: seed.employees.slice(0, 1).map(emp => ({
                employeeId: emp.id,
                timeIn: '08:00:00',
                timeOut: '17:00:00',
                shiftType: 'REGULAR',
            })),
        });
        await api.updateTimeSheet(sheetRes.body.data.id, { status: 'FILLED' });

        await api.createPayrolls(period1Id);

        // Step 2: ตรวจสอบ payroll สร้างแล้ว และ entry มี paidValue
        const payrolls = await api.getPayrolls({ payPeriodId: period1Id, limit: 10 });
        expect(payrolls.body.pagination.total).toBe(1);
        const payroll = payrolls.body.data[0];
        expect(payroll.status).toBe('PENDING');

        // ตรวจสอบ time entry ใน DB — มี paidValue แต่ paidDate เป็น null
        const entries = await prisma.timeEntry.findMany({
            where: { employeeId, isNegative: false, isRetro: false },
            select: { id: true, paidValue: true, paidDate: true },
        });
        expect(entries.length).toBe(1);
        expect(entries[0].paidValue).not.toBeNull();
        console.log('[INFO] Before paidDate set — paidValue:', Number(entries[0].paidValue), 'paidDate:', entries[0].paidDate);

        // Step 3: เลียนแบบ "จ่ายเงินแล้ว" — set paidDate ด้วยมือ
        // (เนื่องจาก flow จ่ายจริงยังไม่ implement paidDate)
        const paidDate = new Date('2025-06-15T12:00:00');
        await prisma.timeEntry.update({
            where: { id: entries[0].id },
            data: { paidDate },
        });

        const entryAfterPaid = await prisma.timeEntry.findUnique({
            where: { id: entries[0].id },
            select: { paidValue: true, paidDate: true },
        });
        console.log('[INFO] After paidDate set — paidValue:', Number(entryAfterPaid.paidValue), 'paidDate:', entryAfterPaid.paidDate);

        // Step 4: เปลี่ยนอัตราค่าจ้าง (ปิดอัตราเก่า เปิดอัตราใหม่)
        await prisma.wageRate.updateMany({
            where: { employeeId, effectiveTo: null },
            data: { effectiveTo: new Date('2025-06-10') },
        });

        await prisma.wageRate.create({
            data: {
                employeeId,
                positionId: seed.workerPosition.id,
                dailyRate: 550,
                hourlyRate: 68.75,
                minuteRate: 1.146,
                monthlyRate: 0,
                effectiveFrom: new Date('2025-06-11'),
                effectiveTo: null,
            },
        });

        console.log('[INFO] Wage rate changed: 500/day → 550/day (effective 2025-06-11)');

        // Step 5: เรียก retro-calculate สำหรับช่วงที่จ่ายด้วยอัตราเก่า
        const retroRes = await api.retroCalculate({
            startDate: '2025-06-01',
            endDate: '2025-06-10',
        });

        console.log('[INFO] retro-calculate response status:', retroRes.status);
        console.log('[INFO] retro-calculate response body:', JSON.stringify(retroRes.body, null, 2));

        expect(retroRes.status).toBe(200);

        // Step 6: ตรวจสอบผลลัพธ์
        const retroSummary = retroRes.body.summary;

        // ต้องมีพนักงานที่ต่าง
        expect(retroSummary.totalEmployees).toBeGreaterThanOrEqual(1);

        // ตรวจสอบ retro entries ที่ถูกสร้างใน DB
        const retroEntries = await prisma.timeEntry.findMany({
            where: { employeeId, isRetro: true },
            select: {
                id: true,
                isRetro: true,
                referenceEntryId: true,
                paidValue: true,
                workType: true,
                shiftType: true,
                note: true,
            },
        });

        console.log('[INFO] Retro entries in DB:', JSON.stringify(retroEntries, null, 2));

        // ต้องสร้าง retro entry อย่างน้อย 1 รายการ
        expect(retroEntries.length).toBeGreaterThanOrEqual(1);

        // ตรวจสอบคุณสมบัติของ retro entry
        const retro = retroEntries[0];
        expect(retro.isRetro).toBe(true);
        expect(retro.referenceEntryId).toBe(entries[0].id);
        expect(retro.paidValue).not.toBeNull();
        expect(Number(retro.paidValue)).toBeGreaterThan(0);

        // Step 7: ตรวจสอบค่าคำนวณ
        // อัตราเก่า: 500/day = 500/480 = 1.04167/min
        // ทำงาน 08:00-17:00 = 9 ชม. = 540 นาที - 60 นาทีพัก = 480 นาที
        // จ่ายเดิม: 480 * (500/480) = 500
        // อัตราใหม่: 550/day = 550/480 = 1.14583/min
        // ควรจ่าย: 480 * (550/480) = 550
        // ส่วนต่าง: 550 - 500 = 50
        const expectedDiff = 50;
        const actualDiff = Number(retro.paidValue);
        console.log(`[INFO] Expected diff: ${expectedDiff}, Actual diff: ${actualDiff}`);

        expect(Math.abs(actualDiff - expectedDiff)).toBeLessThan(1);
    });

    it('should return empty result when no paidDate entries exist', async () => {
        // สร้างรอบจ่าย + timesheet + payroll แต่ไม่ set paidDate
        const periodRes = await api.createPayPeriod({
            periodNo: 1,
            year: 2025,
            employeeType: 'WORKER',
            startDate: '2025-06-01',
            endDate: '2025-06-15',
        });

        const sheetRes = await api.createWorkerTimeSheet({
            workLeaderId: seed.workLeader.id,
            workDate: '2025-06-02',
            pattern: { regular: true, ot: 0 },
            entries: seed.employees.slice(0, 1).map(emp => ({
                employeeId: emp.id,
                timeIn: '08:00:00',
                timeOut: '17:00:00',
                shiftType: 'REGULAR',
            })),
        });
        await api.updateTimeSheet(sheetRes.body.data.id, { status: 'FILLED' });
        await api.createPayrolls(periodRes.body.data.id);

        // เรียก retro-calculate — ไม่มี paidDate ต้องได้ผลลัพธ์ว่าง
        const retroRes = await api.retroCalculate({
            startDate: '2025-06-01',
            endDate: '2025-06-15',
        });

        expect(retroRes.status).toBe(200);
        expect(retroRes.body.data).toHaveLength(0);
        expect(retroRes.body.summary.totalEmployees).toBe(0);
        expect(retroRes.body.summary.totalDiff).toBe(0);
    });
});

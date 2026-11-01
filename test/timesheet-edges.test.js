import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { cleanDatabase, disconnectPrisma } from './helpers/db.js';
import { createTestAuth } from './helpers/auth.js';
import { seedTestData } from './helpers/seed.js';
import { createApiClient } from './helpers/client.js';
import { TimeEntry } from '../src/database/index.js';
import IORedis from 'ioredis';

// ขอบของโมดูลลงเวลา + correction (negative entry) เต็มวงจร
// expected ทั้งหมดอ่านจากโค้ดจริง (timesheet.service / pay-period.service / controller)
// จุดที่ behavior ผิดจากเอกสาร (flows.md) จะมี comment ขึ้นต้นด้วย "FINDING"
describe('Timesheet edges: overlap / duplicate / ACCOMMODATION / CRUD / correction', () => {
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

    // ============================================
    // A. Overlap
    // ============================================
    it('rejects new sheet whose entry overlaps an existing FILLED sheet entry (409 DATABASE_OVERLAP)', async () => {
        // sheet แรก 2 คน 08:00-17:00 → FILLED
        const sheet1Res = await api.createWorkerTimeSheet({
            workLeaderId: seed.workLeader.id,
            workDate: '2025-06-02',
            pattern: { regular: true, ot: 0 },
            entries: seed.employees.slice(0, 2).map(emp => ({
                employeeId: emp.id,
                timeIn: '08:00:00',
                timeOut: '17:00:00',
                shiftType: 'REGULAR',
            })),
        });
        expect(sheet1Res.status).toBe(201);
        const sheet1Id = sheet1Res.body.data.id;
        await api.updateTimeSheet(sheet1Id, { status: 'FILLED' });

        // sheet ใหม่วันเดียวกัน คนเดิม เวลา 09:00-12:00 ทับ 08:00-17:00
        // ต้องส่ง allowDuplicate: true ไม่งั้นโดน duplicate-sheet check (ซึ่งรันก่อน) ปฏิเสธก่อนถึง overlap
        const overlapRes = await api.createWorkerTimeSheet({
            workLeaderId: seed.workLeader.id,
            workDate: '2025-06-02',
            allowDuplicate: true,
            pattern: { regular: true, ot: 0 },
            entries: [{
                employeeId: seed.employees[0].id,
                timeIn: '09:00:00',
                timeOut: '12:00:00',
                shiftType: 'REGULAR',
            }],
        });
        expect(overlapRes.status).toBe(409);
        expect(overlapRes.body.error.code).toBe('CONFLICT');
        expect(overlapRes.body.error.details.conflicts).toHaveLength(1);
        expect(overlapRes.body.error.details.conflicts[0].type).toBe('DATABASE_OVERLAP');
        expect(overlapRes.body.error.details.conflicts[0].employeeId).toBe(seed.employees[0].id);

        // transaction ต้อง rollback — sheet เดิมไม่โดนแตะ และไม่มี sheet กำพร้า
        const sheet1After = await api.getTimesheetById(sheet1Id);
        expect(sheet1After.status).toBe(200);
        expect(sheet1After.body.data.timeEntries).toHaveLength(2);

        const listRes = await api.getTimesheets({ workLeaderId: seed.workLeader.id });
        expect(listRes.body.pagination.total).toBe(1);
    });

    it('allows back-to-back entries (08:00-10:00 then 10:00-12:00) — boundary touch is NOT overlap', async () => {
        const sheet1Res = await api.createWorkerTimeSheet({
            workLeaderId: seed.workLeader.id,
            workDate: '2025-06-02',
            pattern: { regular: true, ot: 0 },
            entries: [{
                employeeId: seed.employees[0].id,
                timeIn: '08:00:00',
                timeOut: '10:00:00',
                shiftType: 'REGULAR',
            }],
        });
        expect(sheet1Res.status).toBe(201);

        // _hasTimeOverlap = start1 < end2 && end1 > start2 → end1 === start2 (10:00) ไม่ทับ
        const sheet2Res = await api.createWorkerTimeSheet({
            workLeaderId: seed.workLeader.id,
            workDate: '2025-06-02',
            allowDuplicate: true,
            pattern: { regular: true, ot: 0 },
            entries: [{
                employeeId: seed.employees[0].id,
                timeIn: '10:00:00',
                timeOut: '12:00:00',
                shiftType: 'REGULAR',
            }],
        });
        expect(sheet2Res.status).toBe(201);
        expect(sheet2Res.body.data.timeEntries).toHaveLength(1);
    });

    it('rejects two overlapping entries of the same employee within a single request (409 INTERNAL_OVERLAP)', async () => {
        const res = await api.createWorkerTimeSheet({
            workLeaderId: seed.workLeader.id,
            workDate: '2025-06-02',
            pattern: { regular: true, ot: 0 },
            entries: [
                { employeeId: seed.employees[0].id, timeIn: '09:00:00', timeOut: '12:00:00', shiftType: 'REGULAR' },
                { employeeId: seed.employees[0].id, timeIn: '11:00:00', timeOut: '15:00:00', shiftType: 'REGULAR' },
            ],
        });
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('CONFLICT');
        expect(res.body.error.details.conflicts[0].type).toBe('INTERNAL_OVERLAP');

        // ไม่มี sheet ถูกสร้าง
        const listRes = await api.getTimesheets({ workLeaderId: seed.workLeader.id });
        expect(listRes.body.pagination.total).toBe(0);
    });

    // ============================================
    // B. Duplicate sheet + allowDuplicate
    // ============================================
    it('duplicate sheet (same leader+date) → 409 duplicate check (runs BEFORE overlap); allowDuplicate: true → 201', async () => {
        const sheet1Res = await api.createWorkerTimeSheet({
            workLeaderId: seed.workLeader.id,
            workDate: '2025-06-02',
            pattern: { regular: true, ot: 0 },
            entries: [{
                employeeId: seed.employees[0].id,
                timeIn: '08:00:00',
                timeOut: '12:00:00',
                shiftType: 'REGULAR',
            }],
        });
        expect(sheet1Res.status).toBe(201);

        // ซ้ำ leader+วันเดียวกัน (sheet แรกยัง PENDING — duplicate check ไม่สน status)
        const dupRes = await api.createWorkerTimeSheet({
            workLeaderId: seed.workLeader.id,
            workDate: '2025-06-02',
            pattern: { regular: true, ot: 0 },
            entries: [{
                employeeId: seed.employees[0].id,
                timeIn: '08:00:00',
                timeOut: '12:00:00',
                shiftType: 'REGULAR',
            }],
        });
        expect(dupRes.status).toBe(409);
        expect(dupRes.body.error.message).toContain('มีการลงเวลาสำหรับหัวหน้างานและวันที่นี้แล้ว');
        expect(dupRes.body.error.details.workLeaderId).toBe(seed.workLeader.id);
        // พิสูจน์ว่าโดน duplicate branch ไม่ใช่ overlap branch (ไม่มี conflicts array)
        expect(dupRes.body.error.details.conflicts).toBeUndefined();

        // allowDuplicate: true → ผ่าน duplicate check (เวลาไม่ทับ 08:00-12:00)
        const allowRes = await api.createWorkerTimeSheet({
            workLeaderId: seed.workLeader.id,
            workDate: '2025-06-02',
            allowDuplicate: true,
            pattern: { regular: true, ot: 0 },
            entries: [{
                employeeId: seed.employees[0].id,
                timeIn: '13:00:00',
                timeOut: '17:00:00',
                shiftType: 'REGULAR',
            }],
        });
        expect(allowRes.status).toBe(201);
        expect(allowRes.body.data.timeEntries).toHaveLength(1);
    });

    // ============================================
    // C. ACCOMMODATION
    // ============================================
    it('worker endpoint silently drops workType (stripUnknown) — ACCOMMODATION is only on driver endpoints', async () => {
        // FINDING: schema ของ POST /timesheets/worker ไม่มี field workType/accommodation
        // และ validate() ใช้ stripUnknown → ส่ง workType: ACCOMMODATION มาจะถูกตัดทิ้งเงียบๆ
        // แล้วสร้างเป็น entry REGULAR ตาม pattern (ไม่ error และไม่มี accommodation)
        const res = await api.createWorkerTimeSheet({
            workLeaderId: seed.workLeader.id,
            workDate: '2025-06-02',
            pattern: { regular: true, ot: 0 },
            entries: [{
                employeeId: seed.employees[0].id,
                timeIn: '08:00:00',
                timeOut: '17:00:00',
                shiftType: 'REGULAR',
                workType: 'ACCOMMODATION',
                accommodation: 300,
            }],
        });
        expect(res.status).toBe(201);
        expect(res.body.data.timeEntries[0].workType).toBe('REGULAR');
        expect(Number(res.body.data.timeEntries[0].accommodation)).toBe(0);
    });

    it('driver sheet: ACCOMMODATION entry ok (endTime null); duplicate date → 409; different date → 201', async () => {
        const sheetRes = await api.createDriverTimeSheet({
            employeeId: seed.employees[4].id,
            monthPeriod: '2025-06',
            entries: [
                { date: '2025-06-02', timeIn: '08:00:00', timeOut: '17:00:00', workType: 'REGULAR', otRate: 0, accommodation: 0 },
                { date: '2025-06-02', timeIn: null, timeOut: null, workType: 'ACCOMMODATION', otRate: 0, accommodation: 300 },
            ],
        });
        expect(sheetRes.status).toBe(201);
        const sheet = sheetRes.body.data;
        expect(sheet.timeEntries).toHaveLength(2);

        const acc = sheet.timeEntries.find(e => e.workType === 'ACCOMMODATION');
        expect(acc).toBeDefined();
        expect(acc.endTime).toBeNull();
        expect(Number(acc.accommodation)).toBe(300);

        // เพิ่ม ACCOMMODATION ซ้ำวันเดียวกันผ่าน driver entry endpoint → conflict
        const dupRes = await api.createDriverTimeEntry(sheet.id, {
            date: '2025-06-02',
            timeIn: null,
            timeOut: null,
            workType: 'ACCOMMODATION',
            otRate: 0,
            accommodation: 300,
        });
        expect(dupRes.status).toBe(409);
        expect(dupRes.body.error.message).toContain('พบ ACCOMMODATION ซ้ำ 1 รายการกับข้อมูลที่มีอยู่');
        expect(dupRes.body.error.details.duplicates).toEqual([{ date: '2025-06-02' }]);

        // วันอื่นในเดือนเดียวกัน → ผ่าน
        const okRes = await api.createDriverTimeEntry(sheet.id, {
            date: '2025-06-05',
            timeIn: null,
            timeOut: null,
            workType: 'ACCOMMODATION',
            otRate: 0,
            accommodation: 300,
        });
        expect(okRes.status).toBe(201);
        expect(okRes.body.data.workType).toBe('ACCOMMODATION');
        expect(okRes.body.data.endTime).toBeNull();
    });

    // ============================================
    // D. Entry CRUD บน sheet
    // ============================================
    it('adds entry on PENDING sheet (pattern copied from first entry) → 201; delete entry → gone', async () => {
        const sheetRes = await api.createWorkerTimeSheet({
            workLeaderId: seed.workLeader.id,
            workDate: '2025-06-02',
            pattern: { regular: true, ot: 0 },
            entries: [{
                employeeId: seed.employees[0].id,
                timeIn: '08:00:00',
                timeOut: '12:00:00',
                shiftType: 'REGULAR',
            }],
        });
        const sheetId = sheetRes.body.data.id;

        // เพิ่ม entry คนที่ 2 — workType/otRate ถูก copy จาก entry แรกของ sheet
        const addRes = await api.createWorkerTimeEntry(sheetId, {
            employeeId: seed.employees[1].id,
            timeIn: '13:00:00',
            timeOut: '17:00:00',
            shiftType: 'REGULAR',
        });
        expect(addRes.status).toBe(201);
        expect(addRes.body.data.workType).toBe('REGULAR');
        expect(Number(addRes.body.data.otRate)).toBe(0);
        expect(addRes.body.data.employee.id).toBe(seed.employees[1].id);

        let sheet = await api.getTimesheetById(sheetId);
        expect(sheet.body.data.timeEntries).toHaveLength(2);
        expect(sheet.body.data.status).toBe('PENDING');

        // ลบ entry ที่เพิ่ม → หายจาก sheet
        const delRes = await api.deleteTimeEntry(sheetId, addRes.body.data.id);
        expect(delRes.status).toBe(204);

        sheet = await api.getTimesheetById(sheetId);
        expect(sheet.body.data.timeEntries).toHaveLength(1);
        expect(sheet.body.data.timeEntries[0].employeeId).toBe(seed.employees[0].id);
    });

    it('deleting a FILLED sheet → 422; deleting its positive entry → 422 (sheet confirmed)', async () => {
        const sheetRes = await api.createWorkerTimeSheet({
            workLeaderId: seed.workLeader.id,
            workDate: '2025-06-02',
            pattern: { regular: true, ot: 0 },
            entries: [{
                employeeId: seed.employees[0].id,
                timeIn: '08:00:00',
                timeOut: '17:00:00',
                shiftType: 'REGULAR',
            }],
        });
        const sheetId = sheetRes.body.data.id;
        const entryId = sheetRes.body.data.timeEntries[0].id;
        await api.updateTimeSheet(sheetId, { status: 'FILLED' });

        const delSheetRes = await api.deleteTimeSheet(sheetId);
        expect(delSheetRes.status).toBe(422);
        expect(delSheetRes.body.error.code).toBe('VALIDATION_ERROR');
        // service ใช้ err.validation({ message }) → ข้อความจริงอยู่ใน details.message
        expect(delSheetRes.body.error.details.message).toContain('สามารถลบได้เฉพาะ TimeSheet ที่มีสถานะ PENDING เท่านั้น');

        const delEntryRes = await api.deleteTimeEntry(sheetId, entryId);
        expect(delEntryRes.status).toBe(422);
        expect(delEntryRes.body.error.details.message).toContain('TimeSheet ยืนยันแล้ว ไม่สามารถลบได้');
    });

    it('deleting a PENDING sheet cascades its entries (verified directly in DB)', async () => {
        const sheetRes = await api.createWorkerTimeSheet({
            workLeaderId: seed.workLeader.id,
            workDate: '2025-06-02',
            pattern: { regular: true, ot: 0 },
            entries: seed.employees.slice(0, 2).map(emp => ({
                employeeId: emp.id,
                timeIn: '08:00:00',
                timeOut: '17:00:00',
                shiftType: 'REGULAR',
            })),
        });
        const sheetId = sheetRes.body.data.id;

        const delRes = await api.deleteTimeSheet(sheetId);
        expect(delRes.status).toBe(204);

        // sheet หาย
        const getRes = await api.getTimesheetById(sheetId);
        expect(getRes.status).toBe(404);

        // entries ถูก cascade ลบตาม (FK time_entries.time_sheet_id ON DELETE CASCADE)
        const remaining = await TimeEntry.count({ where: { timeSheetId: sheetId } });
        expect(remaining).toBe(0);
    });

    // ============================================
    // E. Correction (negative entry)
    // ============================================

    // helper: สร้างรอบ 1 + sheet 08:00-17:00 ให้พนักงาน A + FILLED + สร้าง payroll (entry LOCKED)
    async function setupPaidEntry(workDate) {
        const periodRes = await api.createPayPeriod({
            periodNo: 1,
            year: 2025,
            employeeType: 'WORKER',
            startDate: '2025-03-01',
            endDate: '2025-03-15',
        });
        const periodId = periodRes.body.data.id;

        const sheetRes = await api.createWorkerTimeSheet({
            workLeaderId: seed.workLeader.id,
            workDate,
            pattern: { regular: true, ot: 0 },
            entries: [{
                employeeId: seed.employees[0].id,
                timeIn: '08:00:00',
                timeOut: '17:00:00',
                shiftType: 'REGULAR',
            }],
        });
        const sheetId = sheetRes.body.data.id;
        const originalEntryId = sheetRes.body.data.timeEntries[0].id;
        await api.updateTimeSheet(sheetId, { status: 'FILLED' });

        const payrollRes = await api.createPayrolls(periodId);
        expect(payrollRes.status).toBe(201);
        expect(payrollRes.body.created).toBe(1);
        const payrollId = payrollRes.body.payrolls[0].id;

        return { periodId, sheetId, originalEntryId, payrollId };
    }

    it('correction guards: unpaid original → 422, range outside original → 422, overlapping correction → 409', async () => {
        const { sheetId, originalEntryId } = await setupPaidEntry('2025-03-02');

        // FINDING: createPayrolls เซ็ตแค่ status=LOCKED + paidValue — paidDate ยัง null
        // (flow จ่ายจริง/import bank ยัง TODO) → correction ติด 422 ทันทีหลังสร้าง payroll
        const unpaidRes = await api.createCorrectionTimeEntry(sheetId, {
            originalEntryId,
            timeIn: '09:00:00',
            timeOut: '12:00:00',
            note: null,
        });
        expect(unpaidRes.status).toBe(422);
        expect(unpaidRes.body.error.details.message).toContain('ยังไม่ได้จ่ายเงิน');

        // จำลอง "จ่ายแล้ว" ด้วยการ set paidDate ตรงๆ ตามแบบ flow-9 (ยังไม่มี API ที่เซ็ต paidDate)
        await TimeEntry.update(
            { paidDate: new Date('2025-03-20T10:00:00') },
            { where: { id: originalEntryId } },
        );

        // ช่วงเวลาทับขอบเดิม (07:00 < 08:00) → 422
        const outOfRangeRes = await api.createCorrectionTimeEntry(sheetId, {
            originalEntryId,
            timeIn: '07:00:00',
            timeOut: '09:00:00',
            note: null,
        });
        expect(outOfRangeRes.status).toBe(422);
        expect(outOfRangeRes.body.error.details.message).toContain('ช่วงเวลาต้องอยู่ภายในรายการเดิม');

        // correction แรกผ่าน
        const firstRes = await api.createCorrectionTimeEntry(sheetId, {
            originalEntryId,
            timeIn: '09:00:00',
            timeOut: '12:00:00',
            note: 'ตัดช่วงเช้า',
        });
        expect(firstRes.status).toBe(201);

        // correction ที่สองซ้อนทับกับตัวแรก (11:00-14:00 ทับ 09:00-12:00) → 409
        const overlapRes = await api.createCorrectionTimeEntry(sheetId, {
            originalEntryId,
            timeIn: '11:00:00',
            timeOut: '14:00:00',
            note: null,
        });
        expect(overlapRes.status).toBe(409);
        expect(overlapRes.body.error.message).toContain('มีรายการแก้ไขที่ซ้อนทับกับช่วงเวลานี้อยู่แล้ว');
        expect(overlapRes.body.error.details.existingNegativeEntry.id).toBe(firstRes.body.data.id);
    });

    it('correction full cycle: never enters the NEXT period; deducts in the period covering the ORIGINAL date (via recalculate)', async () => {
        // Step 1: รอบ 1 (1-15 มี.ค.) + sheet 08:00-17:00 พนักงาน A + FILLED + payroll
        const { periodId: period1Id, sheetId, originalEntryId, payrollId: payroll1Id } =
            await setupPaidEntry('2025-03-02');

        // entry ต้นฉบับ LOCKED + paidValue 500 (480 นาทีหลังหักพัก → dailyRate)
        const sheetAfterPay = await api.getTimesheetById(sheetId);
        const original = sheetAfterPay.body.data.timeEntries.find(e => e.id === originalEntryId);
        expect(original.status).toBe('LOCKED');
        expect(Number(original.paidValue)).toBe(500);

        await TimeEntry.update(
            { paidDate: new Date('2025-03-20T10:00:00') },
            { where: { id: originalEntryId } },
        );

        // Step 2: สร้าง correction 09:00-12:00 → 201 + ฟิลด์ตามโค้ดจริง
        const corrRes = await api.createCorrectionTimeEntry(sheetId, {
            originalEntryId,
            timeIn: '09:00:00',
            timeOut: '12:00:00',
            note: 'ตัดช่วงเช้า',
        });
        expect(corrRes.status).toBe(201);
        const corr = corrRes.body.data;
        expect(corr.isNegative).toBe(true);
        expect(corr.workType).toBe('REGULAR');       // copy จาก entry เดิม
        expect(corr.shiftType).toBe('REGULAR');
        expect(Number(corr.otRate)).toBe(0);
        expect(Number(corr.accommodation)).toBe(0);
        expect(corr.referenceEntryId).toBe(originalEntryId);
        expect(corr.status).toBe('DRAFT');
        expect(corr.note).toBe('ตัดช่วงเช้า');
        expect(corr.employee.id).toBe(seed.employees[0].id);

        // Step 3: correction ยัง DRAFT และไม่โดนรวมในรอบ 1 (สร้าง payroll ก่อนหน้าแล้ว)
        const payroll1Before = await api.getPayrollById(payroll1Id);
        expect(payroll1Before.body.data.payrollRelates).toHaveLength(1);
        expect(payroll1Before.body.data.payrollRelates[0].timeEntry.id).toBe(originalEntryId);

        // Step 4: รอบ 2 (16-31 มี.ค.) + sheet วันที่ 20 → payroll รอบ 2
        const period2Res = await api.createPayPeriod({
            periodNo: 2,
            year: 2025,
            employeeType: 'WORKER',
            startDate: '2025-03-16',
            endDate: '2025-03-31',
        });
        const period2Id = period2Res.body.data.id;

        const sheet2Res = await api.createWorkerTimeSheet({
            workLeaderId: seed.workLeader.id,
            workDate: '2025-03-20',
            pattern: { regular: true, ot: 0 },
            entries: [{
                employeeId: seed.employees[0].id,
                timeIn: '08:00:00',
                timeOut: '17:00:00',
                shiftType: 'REGULAR',
            }],
        });
        await api.updateTimeSheet(sheet2Res.body.data.id, { status: 'FILLED' });

        const payroll2Res = await api.createPayrolls(period2Id);
        expect(payroll2Res.body.created).toBe(1);
        const payroll2Id = payroll2Res.body.payrolls[0].id;

        // FINDING (สำคัญ): correction ไม่เข้ารอบ 2 ไม่ว่าทางไหน —
        //  a) createPayrollsForPeriod กรอง isNegative: false ทั้ง candidate query
        //  b) startTime ของ correction ผูกกับ "วันที่ของ entry ต้นฉบับ" (2 มี.ค.)
        //     ซึ่งอยู่นอกช่วง 16-31 มี.ค. ของทั้ง createPayrolls และ recalculate
        // ขัดกับโน้ต flows.md ที่ว่า "negative entry ใช้จ่ายในรอบถัดไป"
        const payroll2 = await api.getPayrollById(payroll2Id);
        expect(payroll2.body.data.payrollRelates).toHaveLength(1);
        expect(payroll2.body.data.payrollRelates[0].timeEntry.isNegative).toBe(false);

        const recalc2Res = await api.recalculatePeriod(period2Id);
        expect(recalc2Res.status).toBe(200);
        expect(recalc2Res.body.payrolls[0].newEntries).toBe(0);

        const period2Detail = await api.getPayPeriodById(period2Id);
        expect(period2Detail.body.data.payrolls[0].summary.deductionAmount).toBe(0);
        expect(period2Detail.body.data.payrolls[0].summary.netPay).toBe(500);

        // Step 5: path จริงที่ deduction ทำงาน — recalculate รอบที่ "คลุมวันที่ entry ต้นฉบับ" (รอบ 1)
        // payroll รอบ 1 ยัง PENDING (import PAID ยัง TODO) → recalculate ได้
        const recalc1Res = await api.recalculatePeriod(period1Id);
        expect(recalc1Res.status).toBe(200);
        expect(recalc1Res.body.payrolls[0].newEntries).toBe(1);

        const period1Detail = await api.getPayPeriodById(period1Id);
        const summary1 = period1Detail.body.data.payrolls[0].summary;
        // correction 09:00-12:00 = 180 นาที × 62.5 = 187.5 → paidValue = -187.5
        expect(summary1.regularAmount).toBe(500);
        expect(summary1.deductionAmount).toBe(187.5);
        expect(summary1.netPay).toBe(312.5);

        // FINDING: recalculate ดึง DRAFT negative entry เข้า relate แต่ "ไม่เปลี่ยน status เป็น LOCKED"
        const corrInDb = await TimeEntry.findByPk(corr.id);
        expect(corrInDb.status).toBe('DRAFT');
        expect(Number(corrInDb.paidValue)).toBe(-187.5);

        // Step 6: ลบ correction ที่ถูก link แล้ว → FK payroll_relates.time_entry_id (RESTRICT) → 500
        // FINDING: ไม่มี API path ไหนลบ correction ที่ถูก link ได้ ต้อง cancel payroll ก่อน
        const delLinkedRes = await api.deleteTimeEntry(sheetId, corr.id);
        expect(delLinkedRes.status).toBe(500);
        expect(delLinkedRes.body.error.code).toBe('INTERNAL_SERVER_ERROR');

        // คืนสภาพ: cancel payroll รอบ 1 (PENDING → CANCELLED, relates ถูกลบ, entries → DRAFT)
        const cancelRes = await api.cancelPayroll(payroll1Id);
        expect(cancelRes.status).toBe(200);

        // เมื่อไม่มี relate แล้ว → ลบ correction ได้ (isNegative ข้าม check สถานะ sheet ที่ FILLED)
        const delRes = await api.deleteTimeEntry(sheetId, corr.id);
        expect(delRes.status).toBe(204);
        expect(await TimeEntry.findByPk(corr.id)).toBeNull();

        // sheet เหลือ entry เดิม กลับเป็น DRAFT (paidValue ถูกล้าง)
        const sheetFinal = await api.getTimesheetById(sheetId);
        expect(sheetFinal.body.data.timeEntries).toHaveLength(1);
        expect(sheetFinal.body.data.timeEntries[0].status).toBe('DRAFT');
        expect(sheetFinal.body.data.timeEntries[0].paidValue).toBeNull();
    });

    // ============================================
    // F. Files add/remove
    // ============================================
    it('add/remove file only mutates the files JSON column (no external storage call)', async () => {
        // อ่านโค้ดแล้ว: addFile/removeFile เป็น DB-only (push/filter ใน column files)
        // ไม่มีการเรียก R2/S3 → ทดสอบจริงได้ ไม่ต้อง skip
        const sheetRes = await api.createWorkerTimeSheet({
            workLeaderId: seed.workLeader.id,
            workDate: '2025-06-02',
            pattern: { regular: true, ot: 0 },
            entries: [{
                employeeId: seed.employees[0].id,
                timeIn: '08:00:00',
                timeOut: '17:00:00',
                shiftType: 'REGULAR',
            }],
        });
        const sheetId = sheetRes.body.data.id;

        const add1 = await api.addFile(sheetId, { filePath: 'timesheets/2025-06/sign-1.pdf' });
        expect(add1.status).toBe(200);
        expect(add1.body.data.files).toEqual(['timesheets/2025-06/sign-1.pdf']);

        const add2 = await api.addFile(sheetId, { filePath: 'timesheets/2025-06/sign-2.pdf' });
        expect(add2.body.data.files).toHaveLength(2);

        const remove1 = await api.removeFile(sheetId, 'timesheets/2025-06/sign-1.pdf');
        expect(remove1.status).toBe(200);
        expect(remove1.body.data.files).toEqual(['timesheets/2025-06/sign-2.pdf']);

        // ลบ path ที่ไม่มี → files ไม่เปลี่ยน (filter ไม่เจอ)
        const removeNone = await api.removeFile(sheetId, 'timesheets/2025-06/not-exist.pdf');
        expect(removeNone.status).toBe(200);
        expect(removeNone.body.data.files).toEqual(['timesheets/2025-06/sign-2.pdf']);
    });
});

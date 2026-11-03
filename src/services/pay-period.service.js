import { Op } from "sequelize";

import {
    sequelize,
    PayPeriod,
    Payroll,
    PayrollRelate,
    TimeEntry,
    Employee,
    WageRate,
    Position,
    Holiday,
    Leave,
} from "../database/index.js";
import err from "../utils/error.js";
import { toLocalDate, nextMidnight } from "../utils/date.js";
import { effectiveMinutes } from "../utils/work-time.js";

class PayPeriodService {
    constructor() {}

    // ─── Public Methods ────────────────────────────────────────

    async getPayPeriods({ page, limit, sort, sortBy, year, employeeType, status }) {
        const where = {};
        if (year) where.year = year;
        if (employeeType) where.employeeType = employeeType;
        if (status) where.status = status;

        const { rows, count: total } = await PayPeriod.findAndCountAll({
            where,
            offset: (page - 1) * limit,
            limit,
            order: [[sortBy, sort]],
        });

        // นับ payrolls ต่อ period — แทน _count { select: { payrolls: true } } ของ Prisma
        const payrollCounts = await this._countPayrollsByPeriod(rows.map((p) => p.id));

        const data = rows.map((p) => ({
            ...p.toJSON(),
            _count: { payrolls: payrollCounts.get(p.id) ?? 0 },
        }));

        return {
            data,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        };
    }

    async getPayPeriodById(id) {
        const payPeriod = await PayPeriod.findByPk(id, {
            include: [{
                // Prisma include + where คืน parent เสมอแม้ไม่มี row ตรงเงื่อนไข
                // → required: false (LEFT JOIN โดยเงื่อนไขอยู่ใน ON)
                association: "payrolls",
                where: { status: { [Op.ne]: "CANCELLED" } },
                required: false,
                include: [
                    {
                        association: "employee",
                        attributes: ["id", "firstName", "lastName", "idCard", "bankAccount"],
                        // ห้ามใช้ attributes: [] กับ include ระดับกลาง — Sequelize จะทิ้ง
                        // object ทั้งอัน (รวม nested branch) ออกจากผลลัพธ์ ใส่ 'id' แทน
                        include: {
                            association: "workLeader",
                            attributes: ["id"],
                            include: {
                                association: "branch",
                                attributes: ["name"],
                            },
                        },
                    },
                    {
                        association: "payrollRelates",
                        include: {
                            association: "timeEntry",
                            attributes: [
                                "id", "startTime", "endTime", "workType", "shiftType",
                                "otRate", "isNegative", "isRetro", "paidValue",
                            ],
                        },
                    },
                ],
            }],
            order: [[{ model: Payroll, as: "payrolls" }, "id", "ASC"]],
        });

        if (!payPeriod) throw err.notFound({ id }, 'ไม่พบรอบจ่ายเงิน');

        const plain = payPeriod.toJSON();
        const employeeIds = plain.payrolls.map((p) => p.employeeId);
        const wageRateMap = await this._getPrimaryWageRates(employeeIds, plain.startDate);

        const summaryCtx = {
            employeeType: plain.employeeType,
            periodStartDate: plain.startDate,
            periodEndDate: plain.endDate,
        };

        const payrolls = await Promise.all(plain.payrolls.map(async (payroll) => {
            const wageRate = wageRateMap.get(payroll.employeeId)
                ?? { dailyRate: 0, position: { code: null, name: null } };
            const summary = await this._buildPayrollSummary(payroll, wageRate, summaryCtx);
            const { payrollRelates, employee, ...payrollData } = payroll;
            const { workLeader, ...employeeData } = employee;
            return {
                ...payrollData,
                summary,
                employee: {
                    ...employeeData,
                    positionCode: wageRate.position.code,
                    positionName: wageRate.position.name,
                    branchName: workLeader?.branch?.name,
                },
            };
        }));

        return { ...plain, payrolls };
    }

    async createPayPeriod({ periodNo, year, employeeType, startDate, endDate }) {
        const existing = await PayPeriod.findOne({
            where: { year, periodNo, employeeType },
        });

        if (existing) {
            throw err.conflict(
                { year, periodNo, employeeType },
                'รอบจ่ายนี้มีอยู่แล้ว',
            );
        }

        // แปลง "YYYY-MM-DD" เป็นเที่ยงคืนเวลาไทยตรงๆ (numeric-local — ไม่ผ่าน UTC)
        const [sy, sm, sd] = startDate.split('-').map(Number);
        const [ey, em, ed] = endDate.split('-').map(Number);
        const start = new Date(sy, sm - 1, sd);
        const end = new Date(ey, em - 1, ed);
        if (end <= start) {
            throw err.validation({ startDate, endDate }, 'endDate ต้องมากกว่า startDate');
        }

        const payPeriod = await PayPeriod.create({
            periodNo,
            year,
            employeeType,
            startDate: start,
            endDate: end,
        });

        return payPeriod.toJSON();
    }

    async createPayrollsForPeriod(payPeriodId, { employeeId: targetEmployeeId, allowPendingSheets = false } = {}) {
        const payPeriod = await PayPeriod.findByPk(payPeriodId);
        if (!payPeriod) throw err.notFound({ id: payPeriodId }, 'ไม่พบรอบจ่ายเงิน');
        if (payPeriod.status !== 'OPEN') {
            throw err.badRequest(null, 'รอบจ่ายไม่อยู่ในสถานะเปิด ไม่สามารถสร้างรายการจ่ายได้');
        }

        const { startDate, endDate, employeeType } = payPeriod;

        // ถ้าระบุ employeeId → ตรวจสอบว่ายังไม่มี payroll ของคนนี้ใน period นี้
        if (targetEmployeeId) {
            const existing = await Payroll.findOne({
                where: {
                    payPeriodId,
                    employeeId: targetEmployeeId,
                    status: { [Op.ne]: 'CANCELLED' },
                },
            });
            if (existing) {
                throw err.badRequest(
                    { employeeId: targetEmployeeId },
                    'พนักงานนี้มีรายการจ่ายเงินในรอบนี้แล้ว',
                );
            }
        }

        // 1. ดึง employeeIds ที่มี time entry ในช่วงเวลา
        // filter: TimeSheet = FILLED, TimeEntry = DRAFT, isNegative = false, isRetro = false
        // (แทน relation filter timeSheet: { status: 'FILLED' } ด้วย include.where + required
        //  — INNER JOIN มีเงื่อนไขใน ON เทียบเท่า semantics ของ Prisma และไม่โดน trap
        //  ของ nested where key '$alias.field$' ที่ underscored)
        const employeesWithEntries = await TimeEntry.findAll({
            where: {
                status: 'DRAFT',
                isNegative: false,
                isRetro: false,
                startTime: { [Op.gte]: startDate, [Op.lt]: nextMidnight(endDate) },
            },
            attributes: ['employeeId'],
            // qualify ชื่อ table — time_sheets มี employee_id ด้วย ทำให้กำกววมถ้าไม่ระบุ
            group: ['TimeEntry.employee_id'],
            include: {
                association: 'timeSheet',
                attributes: [],
                where: { status: 'FILLED' },
                required: true,
            },
        });

        const candidateEmployeeIds = employeesWithEntries.map((e) => e.employeeId);

        // Worker: คนที่ "มีวันลา" ในรอบแต่ไม่มาทำงานเลย (ลาเต็มรอบ) ก็ต้องได้ payroll
        // — spec: ลาทุกชนิดได้รับค่าจ้างรายวัน (จ่ายผ่าน leaveOnlyPay ในสรุปยอด)
        if (employeeType === 'WORKER') {
            const employeesWithLeaves = await Leave.findAll({
                where: { startTime: { [Op.gte]: startDate, [Op.lte]: endDate } },
                attributes: ['employeeId'],
                group: ['Leave.employee_id'],
            });
            for (const row of employeesWithLeaves) {
                if (!candidateEmployeeIds.includes(row.employeeId)) {
                    candidateEmployeeIds.push(row.employeeId);
                }
            }
        }

        // 2. filter เฉพาะ employee ที่ตรงกับ employeeType
        // (แทน wageRates { some: { position: { employeeType } } } — ดึง position ids ก่อน
        //  แล้วกรอง positionId IN (...) ตาม pattern ของ employee.service เพื่อเลี่ยง
        //  nested include ที่มี where)
        const positionRows = await Position.findAll({
            where: { employeeType },
            attributes: ['id'],
        });

        // 2.5 กันใบลงเวลาค้าง PENDING — entry ของใบ PENDING จะ "ไม่ถูกนับ" ตอนทำจ่าย
        // (driver = ถูกนับขาดทั้งรอบ, worker = วันนั้นหายเงียบๆ)
        // เตือนก่อนเสมอ ยกเว้นยืนยันข้ามด้วย allowPendingSheets (pattern เดียวกับ allowDuplicate)
        // หมายเหตุ: เจ้าของใบ PENDING อาจไม่อยู่ใน candidate pool (candidate มาจากใบ FILLED)
        // จึงเช็คทุกใบ PENDING ในช่วงรอบที่เจ้าของมี wageRate ตรงประเภทของรอบนี้
        // และต้องเช็ค "ก่อน" early-return ของ candidate ว่าง (มิฉะนั้นใบค้างจะหลุดไปเงียบๆ)
        if (!allowPendingSheets) {
            const pendingRows = await TimeEntry.findAll({
                where: {
                    isNegative: false,
                    isRetro: false,
                    startTime: { [Op.gte]: startDate, [Op.lt]: nextMidnight(endDate) },
                },
                attributes: ['employeeId', 'timeSheetId'],
                include: [
                    {
                        association: 'timeSheet',
                        attributes: ['id', 'sheetType', 'workDate', 'monthPeriod'],
                        where: { status: 'PENDING' },
                        required: true,
                    },
                    {
                        association: 'employee',
                        attributes: ['id', 'firstName', 'lastName'],
                        required: true,
                        include: {
                            association: 'wageRates',
                            // ห้ามใช้ attributes: [] กับ include ระดับกลาง — Sequelize ทิ้งทั้ง branch
                            attributes: ['id'],
                            required: true,
                            where: { positionId: { [Op.in]: positionRows.map((p) => p.id) } },
                        },
                    },
                ],
            });

            const sheetsById = new Map();
            for (const row of pendingRows) {
                const sheet = row.timeSheet;
                if (sheetsById.has(sheet.id)) continue;
                sheetsById.set(sheet.id, {
                    sheetId: sheet.id,
                    employeeName: `${row.employee?.firstName ?? ''} ${row.employee?.lastName ?? ''}`.trim(),
                    sheetRef: sheet.sheetType === 'MONTHLY'
                        ? `ใบรายเดือน ${sheet.monthPeriod}`
                        : `ใบรายวัน ${toLocalDate(sheet.workDate)}`,
                });
            }

            if (sheetsById.size > 0) {
                throw err.conflict(
                    { pendingSheets: [...sheetsById.values()] },
                    `มีใบลงเวลาที่ยังไม่ได้ตรวจสอบ (PENDING) ${sheetsById.size} ใบในรอบนี้ — ข้อมูลจะไม่ถูกนับในการทำจ่าย กรุณาตรวจสอบ (FILLED) ให้ครบก่อน หรือยืนยันทำจ่ายโดยไม่รวมใบเหล่านี้`,
                );
            }
        }

        // DRIVER เป็นเงินเดือนรายเดือน — พนักงาน active ที่มี wageRate ในรอบ ได้ payroll ทุกคน
        // แม้ไม่มี time entry เลย (เงินพื้นฐาน monthlyRate ส่วนการขาดคิดจากสูตรรายเดือน)
        if (employeeType !== 'DRIVER' && candidateEmployeeIds.length === 0) {
            return { created: 0, skipped: 0, payrolls: [] };
        }

        const employeeWhere = employeeType === 'DRIVER'
            ? { isActive: true, startDate: { [Op.lte]: endDate } }
            : {
                id: {
                    [Op.in]: targetEmployeeId
                        ? candidateEmployeeIds.filter((id) => id === targetEmployeeId)
                        : candidateEmployeeIds,
                },
                isActive: true,
            };
        if (targetEmployeeId && employeeType === 'DRIVER') {
            employeeWhere.id = targetEmployeeId;
        }

        const employees = await Employee.findAll({
            where: employeeWhere,
            attributes: ['id', 'startDate'],
            include: {
                association: 'wageRates',
                attributes: [],
                required: true,
                where: {
                    positionId: { [Op.in]: positionRows.map((p) => p.id) },
                    effectiveFrom: { [Op.lte]: endDate },
                    [Op.or]: [{ effectiveTo: null }, { effectiveTo: { [Op.gte]: startDate } }],
                },
            },
        });

        if (employees.length === 0) {
            return { created: 0, skipped: 0, payrolls: [] };
        }

        const validEmployeeIds = employees.map((e) => e.id);

        // Correction (isNegative) / Retro (isRetro) ถูกจ่ายใน "รอบถัดไป" —
        // ดึงย้อนหลังจาก startDate ของรอบตามจำนวนวันที่กำหนด (default 90 วัน)
        const lookbackDays = Number(process.env.PAYROLL_LOOKBACK_DAYS || 90);
        const lookbackStart = new Date(startDate);
        lookbackStart.setDate(lookbackStart.getDate() - lookbackDays);

        // 3. ดึง timeEntryIds ที่ linked อยู่แล้ว (รวมช่วง lookback — กันซ้ำข้ามรอบ)
        const alreadyLinked = await PayrollRelate.findAll({
            attributes: ['timeEntryId'],
            include: {
                association: 'timeEntry',
                attributes: [],
                where: {
                    startTime: { [Op.gte]: lookbackStart, [Op.lt]: nextMidnight(endDate) },
                    employeeId: { [Op.in]: validEmployeeIds },
                },
                required: true,
            },
        });
        const linkedEntryIds = new Set(alreadyLinked.map((r) => r.timeEntryId));

        // 4. Transaction: สร้าง Payroll + PayrollRelate
        // (holiday pay คำนวณสดตอนอ่านสรุปยอด — ไม่ต้องดึง Holiday ตรงนี้)
        const results = await sequelize.transaction(async (t) => {
            let seq = await Payroll.count({
                where: { payPeriodId },
                transaction: t,
            });

            const createdPayrolls = [];

            for (const employeeId of validEmployeeIds) {
                // ดึง time entries ที่ยังไม่ linked (FILLED + DRAFT only)
                const timeEntries = await TimeEntry.findAll({
                    where: {
                        employeeId,
                        status: 'DRAFT',
                        startTime: { [Op.gte]: startDate, [Op.lt]: nextMidnight(endDate) },
                        ...(linkedEntryIds.size > 0 && {
                            id: { [Op.notIn]: Array.from(linkedEntryIds) },
                        }),
                    },
                    include: {
                        association: 'timeSheet',
                        attributes: [],
                        where: { status: 'FILLED' },
                        required: true,
                    },
                    order: [['startTime', 'ASC']],
                    transaction: t,
                });

                // Carryover: correction/retro ที่ยังไม่ถูกจ่ายจากรอบก่อน (ดู business rule ด้านบน)
                const carryoverEntries = await TimeEntry.findAll({
                    where: {
                        employeeId,
                        status: 'DRAFT',
                        [Op.or]: [{ isNegative: true }, { isRetro: true }],
                        startTime: { [Op.gte]: lookbackStart, [Op.lt]: startDate },
                        ...(linkedEntryIds.size > 0 && {
                            id: { [Op.notIn]: Array.from(linkedEntryIds) },
                        }),
                    },
                    include: {
                        association: 'timeSheet',
                        attributes: [],
                        where: { status: 'FILLED' },
                        required: true,
                    },
                    order: [['startTime', 'ASC']],
                    transaction: t,
                });

                const allEntries = [...timeEntries, ...carryoverEntries];

                // ดึง wage rates (เริ่มที่ lookbackStart เพื่อให้คำนวณ correction
                // อ้างอัตราของ "วันที่ entry ต้นฉบับ" ได้)
                const wageRatesByDate = await this._getWageRatesByDate(
                    employeeId, lookbackStart, endDate, t,
                );

                // นาทีลารายวัน (worker: นาทีลามา "เติม" วันทำงานให้ครบ 8 ชม. — spec section C)
                const leavesByDate = employeeType === 'WORKER'
                    ? await this._getLeaveMinutesByDate(employeeId, startDate, endDate, t)
                    : new Map();

                // worker ที่มีแต่วันลา (ไม่มี entry) ก็สร้าง payroll — จ่ายที่สรุปยอด
                // driver สร้างเสมอ (เงินเดือนรายเดือน — ไม่มี entry = ขาดทั้งรอบ โดนหักจน clamp 0)
                if (allEntries.length === 0 && employeeType === 'WORKER' && leavesByDate.size === 0) continue;

                // คำนวณ paidValue
                const entryAmounts = this._calculatePayrollAmounts(
                    allEntries, wageRatesByDate,
                    { employeeType, leavesByDate },
                );

                // บันทึก paidValue ลง time entry (bulk update)
                if (entryAmounts.length > 0) {
                    await this._bulkUpdatePaidValue(entryAmounts, t);
                }

                // ปรับ time entry status → LOCKED
                const entryIds = allEntries.map((e) => e.id);
                await TimeEntry.update(
                    { status: 'LOCKED' },
                    { where: { id: { [Op.in]: entryIds } }, transaction: t },
                );

                seq++;
                const payRef = this._generatePayRef(payPeriod.year, payPeriod.periodNo, seq);

                const payroll = await Payroll.create({
                    payRef,
                    employeeId,
                    payPeriodId,
                }, { transaction: t });

                // สร้าง PayrollRelate
                const relateData = allEntries.map((entry) => ({
                    payrollId: payroll.id,
                    timeEntryId: entry.id,
                }));

                await PayrollRelate.bulkCreate(relateData, { transaction: t });

                createdPayrolls.push({
                    ...payroll.toJSON(),
                    entryCount: timeEntries.length,
                });
            }

            return createdPayrolls;
        });

        return {
            created: results.length,
            skipped: validEmployeeIds.length - results.length,
            payrolls: results,
        };
    }

    async cancelAllPayrolls(payPeriodId) {
        const payPeriod = await PayPeriod.findByPk(payPeriodId);
        if (!payPeriod) throw err.notFound({ id: payPeriodId }, 'ไม่พบรอบจ่ายเงิน');
        if (payPeriod.status !== 'OPEN') {
            throw err.badRequest(null, 'รอบจ่ายไม่อยู่ในสถานะเปิด ไม่สามารถยกเลิกได้');
        }

        const payrolls = await Payroll.findAll({
            where: {
                payPeriodId,
                status: { [Op.in]: ['PENDING', 'CALCULATED'] },
            },
            attributes: ['id'],
        });

        if (payrolls.length === 0) {
            return { cancelled: 0, message: 'ไม่มีรายการจ่ายเงินที่สามารถยกเลิกได้' };
        }

        const payrollIds = payrolls.map((p) => p.id);

        await sequelize.transaction(async (t) => {
            // ดึง timeEntryIds ที่เกี่ยวข้องกับ payrolls เหล่านี้
            const relates = await PayrollRelate.findAll({
                where: { payrollId: { [Op.in]: payrollIds } },
                attributes: ['timeEntryId'],
                transaction: t,
            });

            if (relates.length > 0) {
                const entryIds = relates.map((r) => r.timeEntryId);

                // ลบ relates
                await PayrollRelate.destroy({
                    where: { payrollId: { [Op.in]: payrollIds } },
                    transaction: t,
                });

                // คืนสถานะ time entry → DRAFT, paidValue = null
                await TimeEntry.update(
                    { status: 'DRAFT', paidValue: null },
                    { where: { id: { [Op.in]: entryIds } }, transaction: t },
                );
            }

            // ยกเลิก payroll ทั้งหมด
            await Payroll.update(
                { status: 'CANCELLED' },
                { where: { id: { [Op.in]: payrollIds } }, transaction: t },
            );
        });

        return { cancelled: payrollIds.length, message: `ยกเลิกรายการจ่ายเงิน ${payrollIds.length} รายการสำเร็จ` };
    }

    async recalculatePayPeriod(payPeriodId) {
        const payPeriod = await PayPeriod.findByPk(payPeriodId);
        if (!payPeriod) throw err.notFound({ id: payPeriodId }, 'ไม่พบรอบจ่ายเงิน');

        const { startDate, endDate } = payPeriod;

        // ดึง payrolls ที่ยังไม่ PAID และไม่ CANCELLED
        const payrolls = await Payroll.findAll({
            where: {
                payPeriodId,
                status: { [Op.in]: ['PENDING', 'CALCULATED'] },
            },
        });

        if (payrolls.length === 0) {
            return { updated: 0, payrolls: [] };
        }

        // Carryover: correction/retro จากรอบก่อน (business rule เดียวกับ createPayrolls)
        const lookbackDays = Number(process.env.PAYROLL_LOOKBACK_DAYS || 90);
        const lookbackStart = new Date(startDate);
        lookbackStart.setDate(lookbackStart.getDate() - lookbackDays);

        const results = await sequelize.transaction(async (t) => {
            const updated = [];

            for (const payroll of payrolls) {
                // ดึง time entries ที่เกี่ยวข้องทั้งหมดในช่วงเวลา (รวม negative และ retro)
                const inRangeEntries = await TimeEntry.findAll({
                    where: {
                        employeeId: payroll.employeeId,
                        startTime: { [Op.gte]: startDate, [Op.lt]: nextMidnight(endDate) },
                    },
                    include: {
                        association: 'timeSheet',
                        attributes: [],
                        where: { status: 'FILLED' },
                        required: true,
                    },
                    order: [['startTime', 'ASC']],
                    transaction: t,
                });

                // Carryover: correction/retro ที่ยัง DRAFT (ยังไม่ถูกจ่าย) ก่อน startDate ของรอบ
                const carryoverEntries = await TimeEntry.findAll({
                    where: {
                        employeeId: payroll.employeeId,
                        status: 'DRAFT',
                        [Op.or]: [{ isNegative: true }, { isRetro: true }],
                        startTime: { [Op.gte]: lookbackStart, [Op.lt]: startDate },
                    },
                    include: {
                        association: 'timeSheet',
                        attributes: [],
                        where: { status: 'FILLED' },
                        required: true,
                    },
                    order: [['startTime', 'ASC']],
                    transaction: t,
                });

                // กันซ้ำข้ามรอบ: ตัด entry ที่ถูก link กับ payroll อื่น (ไม่ใช่ตัวเอง) ทิ้ง
                const combined = [...inRangeEntries, ...carryoverEntries];
                const otherLinks = combined.length > 0
                    ? await PayrollRelate.findAll({
                        where: {
                            timeEntryId: { [Op.in]: combined.map((e) => e.id) },
                            payrollId: { [Op.ne]: payroll.id },
                        },
                        attributes: ['timeEntryId'],
                        transaction: t,
                    })
                    : [];
                const otherLinkedIds = new Set(otherLinks.map((r) => r.timeEntryId));
                const timeEntries = combined.filter((e) => !otherLinkedIds.has(e.id));

                // ตรวจสอบ time entries ใหม่ที่ยังไม่ linked
                const existingRelates = await PayrollRelate.findAll({
                    where: { payrollId: payroll.id },
                    attributes: ['timeEntryId'],
                    transaction: t,
                });
                const linkedIds = new Set(existingRelates.map((r) => r.timeEntryId));

                const newEntries = timeEntries.filter((e) => !linkedIds.has(e.id));

                // เพิ่ม relate ใหม่ + LOCK สถานะให้สอดคล้องกับ createPayrolls
                if (newEntries.length > 0) {
                    await PayrollRelate.bulkCreate(
                        newEntries.map((entry) => ({
                            payrollId: payroll.id,
                            timeEntryId: entry.id,
                        })),
                        { transaction: t },
                    );
                    await TimeEntry.update(
                        { status: 'LOCKED' },
                        { where: { id: newEntries.map((e) => e.id) }, transaction: t },
                    );
                }

                // คำนวณ paidValue ใหม่จากทุก entry (รวมเก่า + ใหม่ + carryover)
                const wageRatesByDate = await this._getWageRatesByDate(
                    payroll.employeeId, lookbackStart, endDate, t,
                );
                const entryAmounts = this._calculatePayrollAmounts(timeEntries, wageRatesByDate);

                // อัปเดต paidValue ลง time entry (bulk update)
                if (entryAmounts.length > 0) {
                    await this._bulkUpdatePaidValue(entryAmounts, t);
                }

                updated.push({
                    id: payroll.id,
                    entryCount: timeEntries.length,
                    newEntries: newEntries.length,
                });
            }

            return updated;
        });

        return { updated: results.length, payrolls: results };
    }

    async reopenPayPeriod(payPeriodId) {
        const payPeriod = await PayPeriod.findByPk(payPeriodId);
        if (!payPeriod) throw err.notFound({ id: payPeriodId }, 'ไม่พบรอบจ่ายเงิน');
        if (payPeriod.status !== 'CLOSED') {
            throw err.badRequest(null, 'รอบจ่ายไม่อยู่ในสถานะปิด ไม่สามารถเปิดใหม่ได้');
        }

        await payPeriod.update({ status: 'OPEN' });

        return payPeriod.toJSON();
    }

    async exportPayPeriod(payPeriodId) {
        const payPeriod = await PayPeriod.findByPk(payPeriodId);
        if (!payPeriod) throw err.notFound({ id: payPeriodId }, 'ไม่พบรอบจ่ายเงิน');
        if (payPeriod.status !== 'OPEN') {
            throw err.badRequest(null, 'รอบจ่ายไม่อยู่ในสถานะเปิด');
        }

        // //TODO - Generate Excel file
        // const buffer = await this._generateExcelFile(payPeriodId);

        const [updatedCount] = await Payroll.update(
            { status: 'CALCULATED' },
            { where: { payPeriodId, status: 'PENDING' } },
        );

        return {
            message: 'Export successful (TODO: Excel generation)',
            data: { updatedCount },
        };
    }

    async closePayPeriod(payPeriodId, { force = false } = {}) {
        const payPeriod = await PayPeriod.findByPk(payPeriodId);
        if (!payPeriod) throw err.notFound({ id: payPeriodId }, 'ไม่พบรอบจ่ายเงิน');
        if (payPeriod.status !== 'OPEN') {
            throw err.badRequest(null, 'รอบจ่ายไม่อยู่ในสถานะเปิด ไม่สามารถปิดได้');
        }

        const pendingCount = await Payroll.count({
            where: { payPeriodId, status: 'PENDING' },
        });

        if (pendingCount > 0 && !force) {
            throw err.badRequest(
                { pendingPayrollCount: pendingCount },
                `มีรายการจ่าย ${pendingCount} รายการที่ยังไม่ได้ export กรุณา export ก่อนปิดรอบ หรือใช้ force=true`,
            );
        }

        await payPeriod.update({ status: 'CLOSED' });

        return {
            message: pendingCount > 0
                ? `ปิดรอบจ่ายสำเร็จ (มีรายการ PENDING ที่ถูกข้าม ${pendingCount} รายการ)`
                : 'ปิดรอบจ่ายสำเร็จ',
            data: payPeriod.toJSON(),
        };
    }

    // //TODO - Parse bank file and update payroll status to PAID
    async importBankFile(payPeriodId) {
        const payPeriod = await PayPeriod.findByPk(payPeriodId);
        if (!payPeriod) throw err.notFound({ id: payPeriodId }, 'ไม่พบรอบจ่ายเงิน');
        if (payPeriod.status === 'CLOSED') {
            throw err.badRequest(null, 'รอบจ่ายปิดแล้ว ไม่สามารถนำเข้าไฟล์ธนาคารได้');
        }

        return { message: 'TODO: Bank import not implemented' };
    }

    // ─── Private Helpers ───────────────────────────────────────

    /**
     * Bulk update paidValue ของ time entries หลายแถวใน query เดียว
     * ทดแทน Prisma $executeRaw (PG: UPDATE ... FROM (VALUES ...))
     * ด้วยไวยากรณ์ MySQL: CASE WHEN + IN
     * @param {Array<{id: number, paidValue: number}>} entryAmounts
     * @param {Object|null} t - Sequelize transaction
     */
    async _bulkUpdatePaidValue(entryAmounts, t = null) {
        if (!entryAmounts || entryAmounts.length === 0) return;

        const replacements = { ids: entryAmounts.map((e) => e.id) };
        const branches = entryAmounts.map((e, i) => {
            replacements[`id${i}`] = e.id;
            replacements[`pv${i}`] = e.paidValue;
            return `WHEN :id${i} THEN :pv${i}`;
        });

        await sequelize.query(
            `UPDATE time_entries
             SET paid_value = CASE id ${branches.join(' ')} ELSE paid_value END
             WHERE id IN (:ids)`,
            {
                replacements,
                ...(t ? { transaction: t } : {}),
            },
        );
    }

    /**
     * นับ payrolls แยกตาม payPeriodId
     * (ทดแทน _count { select: { payrolls: true } } ของ Prisma)
     * @param {number[]} payPeriodIds
     * @returns {Promise<Map<number, number>>}
     */
    async _countPayrollsByPeriod(payPeriodIds) {
        const counts = new Map();
        if (!payPeriodIds || payPeriodIds.length === 0) {
            return counts;
        }

        const rows = await Payroll.findAll({
            where: { payPeriodId: { [Op.in]: payPeriodIds } },
            attributes: [
                'payPeriodId',
                [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
            ],
            group: ['pay_period_id'],
            raw: true,
        });

        for (const row of rows) {
            // raw: true คืน key เป็นชื่อคอลัมน์ได้ — รองรับทั้งสองแบบกันเหนียว
            const periodId = Number(row.payPeriodId ?? row.pay_period_id);
            counts.set(periodId, Number(row.count));
        }

        return counts;
    }

    /**
     * คำนวณ paidValue ทุก entry ของพนักงาน 1 คน
     *
     * WORKER (spec section C): ค่าจ้างพื้นฐานคิด "ต่อวัน" —
     *   นาทีทำงานจริง + นาทีลาของวันนั้น → ≥480 = dailyRate เต็มวัน / <480 = ย่อยหน่วย
     *   (วันที่มีหลาย REGULAR entry รวมเป็นวันเดียว จ่ายที่ entry แรก)
     *   วันลาที่ไม่มี entry เลย (ลาเต็มวัน) ไม่มีที่ยึด paidValue — จ่ายตอนสรุปยอดแทน
     *
     * @param {Array} timeEntries
     * @param {Map} wageRatesByDate - dateKey → WageRate
     * @param {Object} [ctx]
     * @param {string} [ctx.employeeType] - WORKER ถึงใช้สูตรรายวัน
     * @param {Map} [ctx.leavesByDate] - dateKey → นาทีลาของวันนั้น
     */
    _calculatePayrollAmounts(timeEntries, wageRatesByDate, ctx = null) {
        const entryAmounts = [];

        // WORKER: รวม REGULAR entries เป็นรายวัน + เติมนาทีลา
        const workerDays = ctx?.employeeType === 'WORKER' ? new Map() : null;
        if (workerDays) {
            for (const entry of timeEntries) {
                if (entry.isNegative || entry.isRetro) continue;
                if (entry.workType !== 'REGULAR') continue;
                const dateKey = toLocalDate(entry.startTime);
                if (!workerDays.has(dateKey)) {
                    workerDays.set(dateKey, { entries: [], minutes: 0 });
                }
                const day = workerDays.get(dateKey);
                day.entries.push(entry);
                if (entry.endTime) {
                    day.minutes += effectiveMinutes(entry.startTime, entry.endTime, {
                        lunch: entry.shiftType === 'REGULAR',
                    });
                }
            }

            for (const [dateKey, day] of workerDays) {
                const wageRate = wageRatesByDate.get(dateKey);
                const minutes = day.minutes + (ctx.leavesByDate?.get(dateKey) ?? 0);
                let dayPay = 0;
                if (wageRate && minutes > 0) {
                    const dailyRate = Number(wageRate.dailyRate);
                    const hourlyRate = Number(wageRate.hourlyRate);
                    const minuteRate = Number(wageRate.minuteRate);
                    if (minutes >= 480) {
                        dayPay = dailyRate;
                    } else {
                        dayPay = Math.floor(minutes / 60) * hourlyRate + (minutes % 60) * minuteRate;
                    }
                }
                day.entries.forEach((entry, index) => {
                    entryAmounts.push({ id: entry.id, paidValue: index === 0 ? dayPay : 0 });
                });
            }
        }

        for (const entry of timeEntries) {
            if (ctx?.employeeType === 'DRIVER' && entry.workType === 'REGULAR') {
                // driver: เงินพื้นฐานมาจาก monthlyRate ไม่ใช่รายวัน —
                // REGULAR entry (รวม correction ติดลบ) ใช้แค่นับ "ชั่วโมงทำจริง" ตอนสรุปยอด
                // (ผลของ correction เดินทางผ่าน absentMinutes ไม่ใช่ deductionAmount)
                entryAmounts.push({ id: entry.id, paidValue: 0 });
            } else if (entry.isNegative) {
                const amount = this._calculateEntryAmount(entry, wageRatesByDate);
                entryAmounts.push({ id: entry.id, paidValue: -amount });
            } else if (entry.isRetro) {
                // retro entries มี paidValue อยู่แล้ว — skip
            } else if (workerDays && entry.workType === 'REGULAR') {
                // WORKER REGULAR จัดการแล้วด้านบน (คิดต่อวัน)
            } else {
                if (entry.workType === 'ACCOMMODATION') {
                    entryAmounts.push({ id: entry.id, paidValue: Number(entry.accommodation || 0) });
                } else {
                    const amount = this._calculateEntryAmount(entry, wageRatesByDate);
                    entryAmounts.push({ id: entry.id, paidValue: amount });
                }
            }
        }

        return entryAmounts;
    }

    /**
     * นาทีลารายวันของพนักงาน 1 คนในช่วง [startDate, endDate]
     * (นาทีลาหักพักกลางวัน 12:00–13:00 ถ้าคร่อม — spec section A)
     * @returns {Promise<Map<string, number>>} dateKey "YYYY-MM-DD" → นาที
     */
    async _getLeaveMinutesByDate(employeeId, startDate, endDate, tx = null) {
        const leaves = await Leave.findAll({
            where: {
                employeeId,
                startTime: { [Op.gte]: startDate, [Op.lt]: nextMidnight(endDate) },
            },
            attributes: ['startTime', 'endTime'],
            ...(tx ? { transaction: tx } : {}),
        });

        const map = new Map();
        for (const leave of leaves) {
            const key = toLocalDate(leave.startTime);
            map.set(key, (map.get(key) ?? 0) + effectiveMinutes(leave.startTime, leave.endTime));
        }
        return map;
    }

    _calculateEntryAmount(entry, wageRatesByDate) {
        const dateKey = toLocalDate(entry.startTime);
        const wageRate = wageRatesByDate.get(dateKey);
        if (!wageRate) return 0;

        const dailyRate = Number(wageRate.dailyRate);
        const hourlyRate = Number(wageRate.hourlyRate);
        const minuteRate = Number(wageRate.minuteRate);
        if (!dailyRate && !hourlyRate) return 0;

        let totalMinutes = 0;
        if (entry.endTime) {
            totalMinutes = Math.round(
                (entry.endTime.getTime() - entry.startTime.getTime()) / (1000 * 60),
            );
            // กะข้ามวัน (เช่น 22:00 → 06:00) endTime ถูกบันทึกเป็นเวลาของวันเดียวกันตอน input
            // ทำให้ผลต่างติดลบ — บวกชดเชย 24 ชม.
            if (totalMinutes < 0) totalMinutes += 24 * 60;
        }

        if (entry.workType === 'REGULAR') {
            let effectiveMinutes = totalMinutes;

            if (entry.shiftType === 'REGULAR' && entry.endTime) {
                const lunchStart = 12 * 60;
                const lunchEnd = 13 * 60;
                const startMin = entry.startTime.getHours() * 60 + entry.startTime.getMinutes();
                const endMin = entry.endTime.getHours() * 60 + entry.endTime.getMinutes();
                const overlapStart = Math.max(startMin, lunchStart);
                const overlapEnd = Math.min(endMin, lunchEnd);
                if (overlapStart < overlapEnd) {
                    effectiveMinutes -= (overlapEnd - overlapStart);
                }
            }

            if (effectiveMinutes >= 480) {
                return dailyRate;
            }

            const fullHours = Math.floor(effectiveMinutes / 60);
            const remainMinutes = effectiveMinutes % 60;
            const result = fullHours * hourlyRate + remainMinutes * minuteRate;
            return result;
        }

        if (entry.workType === 'OVERTIME') {
            const otMultiplier = Number(entry.otRate) || 1;
            if (totalMinutes >= 480) {
                return dailyRate * otMultiplier;
            }
            const fullHours = Math.floor(totalMinutes / 60);
            const remainMinutes = totalMinutes % 60;
            return (fullHours * hourlyRate + remainMinutes * minuteRate) * otMultiplier;
        }

        return 0;
    }

    async _getWageRatesByDate(employeeId, startDate, endDate, tx = null) {
        const wageRates = await WageRate.findAll({
            where: {
                employeeId,
                effectiveFrom: { [Op.lte]: endDate },
                [Op.or]: [
                    { effectiveTo: null },
                    { effectiveTo: { [Op.gte]: startDate } },
                ],
            },
            attributes: [
                'dailyRate', 'hourlyRate', 'minuteRate', 'monthlyRate',
                'effectiveFrom', 'effectiveTo',
            ],
            order: [['effectiveFrom', 'ASC']],
            ...(tx ? { transaction: tx } : {}),
        });

        const rateMap = new Map();
        // เทียบระดับ "วันที่" (string YYYY-MM-DD) — ทนต่อค่าที่ถูกเก็บ skew 07:00
        // (effectiveFrom จาก ISO date-only ถูก parse เป็น UTC → เก็บ 07:00 — เทียบ
        //  timestamp ตรงๆ กับ period เที่ยงคืนจะหลุดวันแรกของ coverage)
        const rateSpans = wageRates.map((rate) => ({
            rate,
            fromKey: toLocalDate(rate.effectiveFrom),
            toKey: rate.effectiveTo ? toLocalDate(rate.effectiveTo) : '9999-12-31',
        }));

        const current = new Date(startDate);
        const last = new Date(endDate);
        while (current <= last) {
            const dateStr = toLocalDate(current);
            for (const span of rateSpans) {
                if (dateStr >= span.fromKey && dateStr <= span.toKey) {
                    rateMap.set(dateStr, span.rate);
                    break;
                }
            }
            current.setDate(current.getDate() + 1);
        }

        return rateMap;
    }

    /**
     * สรุปยอดจ่ายของ payroll 1 ใบ
     *
     * WORKER (spec section C) เพิ่มที่นี่ (คำนวณสดจากตาราง Holiday/Leave):
     * - holidayPay: ทุกวันนักขัตฤกษ์ในรอบ (≥ employee.startDate) ได้ dailyRate ณ วันนั้น
     *   — ไม่ว่าจะมาทำหรือไม่ (มาทำ = ลง holiday_2x/3x ได้เงิน entry เพิ่มอีกชั้น)
     * - leaveOnlyPay: วันลาที่ "ไม่มี REGULAR entry" (ลาเต็มวัน/บางวันโดยไม่มาทำงาน)
     *   — ไม่มี entry ให้ยึด paidValue จึงจ่ายตอนสรุปยอด ตามเกณฑ์ 480 นาทีเหมือนกัน
     * - นาทีลา (ทุกกรณี) รวมเข้า regularEffectiveMinutes เพื่อนับ workingDays
     *
     * @param {Object} payroll - พร้อม payrollRelates.timeEntry
     * @param {Object} wageRate - wage rate หลักของรอบ (แสดง dailyRate)
     * @param {Object} [ctx]
     * @param {string} [ctx.employeeType] - WORKER / DRIVER
     * @param {Date} [ctx.periodStartDate]
     * @param {Date} [ctx.periodEndDate]
     */
    async _buildPayrollSummary(payroll, wageRate, ctx = null) {
        const entries = payroll.payrollRelates.map((r) => r.timeEntry);

        let regularAmount = 0;
        let otAmount = 0;
        let accommodationAmount = 0;
        let regularEffectiveMinutes = 0;
        const otMinutes = { '1': 0, '1.5': 0, '2': 0, '3': 0 };
        let deductionAmount = 0;
        let retroAmount = 0;
        let holidayDays = 0;
        let holidayAmount = 0;
        let leaveOnlyMinutes = 0;
        let leaveOnlyAmount = 0;

        for (const entry of entries) {
            const paidValue = entry.paidValue != null ? Number(entry.paidValue) : 0;

            if (entry.isNegative) {
                deductionAmount += Math.abs(paidValue);
            } else if (entry.isRetro) {
                retroAmount += paidValue;
            } else {
                if (entry.workType === 'REGULAR') {
                    regularAmount += paidValue;
                    if (entry.endTime) {
                        regularEffectiveMinutes += effectiveMinutes(
                            entry.startTime, entry.endTime,
                            { lunch: entry.shiftType === 'REGULAR' },
                        );
                    }
                } else if (entry.workType === 'OVERTIME') {
                    otAmount += paidValue;
                    const rateKey = String(Number(entry.otRate) || 1);
                    if (entry.endTime) {
                        const minutes = effectiveMinutes(entry.startTime, entry.endTime, { lunch: false });
                        if (otMinutes.hasOwnProperty(rateKey)) {
                            otMinutes[rateKey] += minutes;
                        } else {
                            otMinutes[rateKey] = minutes;
                        }
                    }
                } else if (entry.workType === 'ACCOMMODATION') {
                    accommodationAmount += paidValue;
                }
            }
        }

        if (ctx?.employeeType === 'WORKER' && ctx.periodStartDate && ctx.periodEndDate) {
            // วันที่มี REGULAR entry — นาทีลาของวันเหล่านี้ถูก top-up เข้า paidValue แล้ว
            const regularDays = new Set(
                entries
                    .filter((e) => !e.isNegative && !e.isRetro && e.workType === 'REGULAR')
                    .map((e) => toLocalDate(e.startTime)),
            );

            const [holidayRows, leaves, wageRatesByDate, employee] = await Promise.all([
                Holiday.findAll({
                    where: { holidayDate: { [Op.gte]: ctx.periodStartDate, [Op.lte]: ctx.periodEndDate } },
                    attributes: ['holidayDate'],
                }),
                Leave.findAll({
                    where: {
                        employeeId: payroll.employeeId,
                        startTime: { [Op.gte]: ctx.periodStartDate, [Op.lt]: nextMidnight(ctx.periodEndDate) },
                    },
                    attributes: ['startTime', 'endTime'],
                }),
                this._getWageRatesByDate(payroll.employeeId, ctx.periodStartDate, ctx.periodEndDate),
                Employee.findByPk(payroll.employeeId, { attributes: ['startDate'] }),
            ]);

            for (const holiday of holidayRows) {
                if (employee?.startDate && holiday.holidayDate < employee.startDate) continue;
                holidayDays++;
                holidayAmount += Number(wageRatesByDate.get(toLocalDate(holiday.holidayDate))?.dailyRate ?? 0);
            }

            const leaveMinutesByDay = new Map();
            for (const leave of leaves) {
                const key = toLocalDate(leave.startTime);
                const minutes = effectiveMinutes(leave.startTime, leave.endTime);
                leaveMinutesByDay.set(key, (leaveMinutesByDay.get(key) ?? 0) + minutes);
            }
            for (const [dateKey, minutes] of leaveMinutesByDay) {
                regularEffectiveMinutes += minutes;
                if (!regularDays.has(dateKey)) {
                    const rate = wageRatesByDate.get(dateKey);
                    if (rate && minutes > 0) {
                        leaveOnlyMinutes += minutes;
                        leaveOnlyAmount += minutes >= 480
                            ? Number(rate.dailyRate)
                            : Math.floor(minutes / 60) * Number(rate.hourlyRate) + (minutes % 60) * Number(rate.minuteRate);
                    }
                }
            }

            regularAmount += holidayAmount + leaveOnlyAmount;
            // วันหยุด = 1 วันทำงานเต็มวันในสายตา workingDays (ตามระบบ "แรง" ในแผ่นจ่ายจริง)
            regularEffectiveMinutes += holidayDays * 480;
        }

        let driverSummary = null;
        if (ctx?.employeeType === 'DRIVER' && ctx.periodStartDate && ctx.periodEndDate) {
            driverSummary = await this._buildDriverSummary(payroll, entries, wageRate, ctx);
            regularAmount += driverSummary.basePay;
        }

        const sso = Number(payroll.ssoAmount) || 0;
        const slf = Number(payroll.slfAmount) || 0;
        const other = Number(payroll.otherDeduction) || 0;

        let netPay = Math.round(
            (regularAmount + otAmount + accommodationAmount + retroAmount - deductionAmount - sso - slf - other) * 100,
        ) / 100;

        // driver: ยอดจ่ายไม่ติดลบ (clamp ที่ 0 — spec section D)
        if (driverSummary) {
            netPay = Math.max(0, netPay);
        }

        const workingDays = driverSummary
            ? driverSummary.workedDays
            : Math.round((regularEffectiveMinutes / 480) * 1000) / 1000;

        return {
            dailyRate: wageRate.dailyRate || 0,
            regularAmount: Math.round(regularAmount * 100) / 100,
            otAmount: Math.round(otAmount * 100) / 100,
            accommodationAmount: Math.round(accommodationAmount * 100) / 100,
            deductionAmount: Math.round(deductionAmount * 100) / 100,
            retroAmount: Math.round(retroAmount * 100) / 100,
            holidayDays,
            holidayAmount: Math.round(holidayAmount * 100) / 100,
            leaveOnlyMinutes,
            leaveOnlyAmount: Math.round(leaveOnlyAmount * 100) / 100,
            workingDays,
            overtimeMinutes: otMinutes,
            netPay,
            ...(driverSummary ? {
                payMode: driverSummary.payMode,
                monthlyRate: driverSummary.monthlyRate,
                absentMinutes: driverSummary.absentMinutes,
                absenceDeduction: driverSummary.absenceDeduction,
                basePay: driverSummary.basePay,
                netDays: driverSummary.netDays,
            } : {}),
        };
    }

    /**
     * สรุปยอดฝั่ง DRIVER (spec section D) — เงินพื้นฐาน = monthlyRate
     *
     * absentMinutes = Σ ทุกวัน จันทร์–เสาร์ (ไม่นับอาทิตย์/นักขัตฤกษ์/ก่อน startDate):
     *                 max(0, 480 − ชั่วโมงทำจริงหักพัก − นาทีลา)
     * เงินหัก = ย่อยหน่วย วัน×daily + ชม.×hourly + นาที×minute (rate ณ วันสุดท้ายของรอบ)
     * เข้าใหม่กลางเดือน (startDate อยู่ในรอบ) → โหมดรายวัน:
     *                 basePay = วันสุทธิ (entry + ลา + นักขัตฤกษ์ จ–ส) × dailyRate รายวัน
     */
    async _buildDriverSummary(payroll, entries, primaryWageRate, ctx) {
        const [holidayRows, leaves, wageRatesByDate, employee] = await Promise.all([
            Holiday.findAll({
                where: { holidayDate: { [Op.gte]: ctx.periodStartDate, [Op.lte]: ctx.periodEndDate } },
                attributes: ['holidayDate'],
            }),
            Leave.findAll({
                where: {
                    employeeId: payroll.employeeId,
                    startTime: { [Op.gte]: ctx.periodStartDate, [Op.lt]: nextMidnight(ctx.periodEndDate) },
                },
                attributes: ['startTime', 'endTime'],
            }),
            this._getWageRatesByDate(payroll.employeeId, ctx.periodStartDate, ctx.periodEndDate),
            Employee.findByPk(payroll.employeeId, { attributes: ['startDate'] }),
        ]);

        const holidaySet = new Set(holidayRows.map((h) => toLocalDate(h.holidayDate)));

        const leaveMinutesByDay = new Map();
        for (const leave of leaves) {
            const key = toLocalDate(leave.startTime);
            const minutes = effectiveMinutes(leave.startTime, leave.endTime);
            leaveMinutesByDay.set(key, (leaveMinutesByDay.get(key) ?? 0) + minutes);
        }

        // นาทีทำงานจริงต่อวันจาก REGULAR entries — correction ติดลบ "ลบนาที" ของวันนั้น
        const workByDay = new Map();
        const workedDaysSet = new Set();
        for (const entry of entries) {
            if (entry.workType !== 'REGULAR' || !entry.endTime) continue;
            const key = toLocalDate(entry.startTime);
            const minutes = effectiveMinutes(entry.startTime, entry.endTime);
            workByDay.set(key, (workByDay.get(key) ?? 0) + (entry.isNegative ? -minutes : minutes));
            if (!entry.isNegative) workedDaysSet.add(key);
        }

        // rate อ้างอิงของรอบ — ณ วันสุดท้าย (แผ่นจริงใช้ rate เดียวทั้งเดือน)
        const periodStart = new Date(ctx.periodStartDate);
        const periodEnd = new Date(ctx.periodEndDate);
        const startKey = toLocalDate(new Date(periodStart.getFullYear(), periodStart.getMonth(), periodStart.getDate()));
        const endKey = toLocalDate(new Date(periodEnd.getFullYear(), periodEnd.getMonth(), periodEnd.getDate()));
        const endRate = wageRatesByDate.get(endKey)
            ?? { ...primaryWageRate, monthlyRate: Number(primaryWageRate.dailyRate) * 30 };

        const startDateKey = employee?.startDate
            ? toLocalDate(new Date(employee.startDate.getFullYear(), employee.startDate.getMonth(), employee.startDate.getDate()))
            : null;
        const isNewcomer = Boolean(startDateKey && startDateKey > startKey);

        let absentMinutes = 0;
        let netDays = 0;
        let netDaysAmount = 0;

        const cursor = new Date(periodStart.getFullYear(), periodStart.getMonth(), periodStart.getDate());
        const lastDay = new Date(periodEnd.getFullYear(), periodEnd.getMonth(), periodEnd.getDate());
        while (cursor <= lastDay) {
            const key = toLocalDate(cursor);
            const isSunday = cursor.getDay() === 0;
            const isHoliday = holidaySet.has(key);

            if (!isSunday && (!startDateKey || key >= startDateKey)) {
                const work = Math.max(0, workByDay.get(key) ?? 0);
                const leave = leaveMinutesByDay.get(key) ?? 0;

                if (isNewcomer) {
                    // โหมดรายวัน: วันสุทธิ = มี entry + วันลา + วันนักขัตฤกษ์ (จ–ส)
                    if (workedDaysSet.has(key) || leave > 0 || isHoliday) {
                        netDays++;
                        netDaysAmount += Number(wageRatesByDate.get(key)?.dailyRate ?? endRate.dailyRate ?? 0);
                    }
                } else if (!isHoliday) {
                    // อาทิตย์/นักขัตฤกษ์/วันลา = ไม่มีชั่วโมงคาดหวัง — ไม่นับขาด
                    absentMinutes += Math.max(0, 480 - work - leave);
                }
            }
            cursor.setDate(cursor.getDate() + 1);
        }

        // เงินหักย่อยหน่วย: ขาด 2 วัน 3 ชม. 10 นาที = 2×daily + 3×hourly + 10×minute
        const fullDays = Math.floor(absentMinutes / 480);
        const remainAfterDays = absentMinutes % 480;
        const fullHours = Math.floor(remainAfterDays / 60);
        const remainMinutes = remainAfterDays % 60;
        const absenceDeduction = fullDays * Number(endRate.dailyRate)
            + fullHours * Number(endRate.hourlyRate)
            + remainMinutes * Number(endRate.minuteRate);

        const monthlyRate = Number(endRate.monthlyRate) || 0;
        const basePay = isNewcomer ? netDaysAmount : Math.max(0, monthlyRate - absenceDeduction);

        return {
            payMode: isNewcomer ? 'DAILY' : 'MONTHLY',
            monthlyRate,
            absentMinutes,
            absenceDeduction: Math.round(absenceDeduction * 100) / 100,
            basePay: Math.round(basePay * 100) / 100,
            netDays: isNewcomer ? netDays : null,
            workedDays: workedDaysSet.size,
        };
    }

    async _getPrimaryWageRates(employeeIds, periodStartDate) {
        if (employeeIds.length === 0) return new Map();

        const wageRates = await WageRate.findAll({
            where: {
                employeeId: { [Op.in]: employeeIds },
                effectiveFrom: { [Op.lte]: periodStartDate },
                [Op.or]: [
                    { effectiveTo: null },
                    { effectiveTo: { [Op.gte]: periodStartDate } },
                ],
            },
            attributes: ['employeeId', 'dailyRate', 'monthlyRate'],
            include: {
                association: 'position',
                attributes: ['name', 'code'],
            },
            order: [
                ['employeeId', 'ASC'],
                ['effectiveFrom', 'DESC'],
            ],
        });

        const rateMap = new Map();
        for (const rate of wageRates) {
            if (!rateMap.has(rate.employeeId)) {
                // rebuild position เป็น { name, code } เฉพาะ (Sequelize เติม PK ของ
                // include ให้เอง — ตัดออกเพื่อคงรูปร่างเหมือน select เดิมของ Prisma)
                rateMap.set(rate.employeeId, {
                    dailyRate: Number(rate.dailyRate),
                    position: {
                        name: rate.position.name,
                        code: rate.position.code,
                    },
                });
            }
        }
        return rateMap;
    }

    // PAY-YYYY-PP-NNN
    // YYYY: ปี
    // PP: รอบ
    // NNN: ลำดับ
    _generatePayRef(year, periodNo, seq) {
        return `PAY-${year}-${String(periodNo).padStart(2, '0')}-${String(seq).padStart(3, '0')}`;
    }
}

export default new PayPeriodService();

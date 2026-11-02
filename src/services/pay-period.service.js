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
} from "../database/index.js";
import err from "../utils/error.js";
import { toLocalDate } from "../utils/date.js";

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

        const payrolls = plain.payrolls.map((payroll) => {
            const wageRate = wageRateMap.get(payroll.employeeId)
                ?? { dailyRate: 0, position: { code: null, name: null } };
            const summary = this._buildPayrollSummary(payroll, wageRate);
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
        });

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

        const payPeriod = await PayPeriod.create({
            periodNo,
            year,
            employeeType,
            startDate: new Date(startDate),
            endDate: new Date(endDate),
        });

        return payPeriod.toJSON();
    }

    async createPayrollsForPeriod(payPeriodId, { employeeId: targetEmployeeId } = {}) {
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
                startTime: { [Op.gte]: startDate, [Op.lte]: endDate },
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

        if (employeesWithEntries.length === 0) {
            return { created: 0, skipped: 0, payrolls: [] };
        }

        const candidateEmployeeIds = employeesWithEntries.map((e) => e.employeeId);

        // 2. filter เฉพาะ employee ที่ตรงกับ employeeType
        // (แทน wageRates { some: { position: { employeeType } } } — ดึง position ids ก่อน
        //  แล้วกรอง positionId IN (...) ตาม pattern ของ employee.service เพื่อเลี่ยง
        //  nested include ที่มี where)
        const positionRows = await Position.findAll({
            where: { employeeType },
            attributes: ['id'],
        });

        const employees = await Employee.findAll({
            where: {
                id: {
                    [Op.in]: targetEmployeeId
                        ? candidateEmployeeIds.filter((id) => id === targetEmployeeId)
                        : candidateEmployeeIds,
                },
                isActive: true,
            },
            attributes: ['id'],
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
                    startTime: { [Op.gte]: lookbackStart, [Op.lte]: endDate },
                    employeeId: { [Op.in]: validEmployeeIds },
                },
                required: true,
            },
        });
        const linkedEntryIds = new Set(alreadyLinked.map((r) => r.timeEntryId));

        // 4. Transaction: สร้าง Payroll + PayrollRelate
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
                        startTime: { [Op.gte]: startDate, [Op.lte]: endDate },
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
                if (allEntries.length === 0) continue;

                // ดึง wage rates (เริ่มที่ lookbackStart เพื่อให้คำนวณ correction
                // อ้างอัตราของ "วันที่ entry ต้นฉบับ" ได้)
                const wageRatesByDate = await this._getWageRatesByDate(
                    employeeId, lookbackStart, endDate, t,
                );

                // คำนวณ paidValue
                const entryAmounts = this._calculatePayrollAmounts(allEntries, wageRatesByDate);

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
                        startTime: { [Op.gte]: startDate, [Op.lte]: endDate },
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

    _calculatePayrollAmounts(timeEntries, wageRatesByDate) {
        const entryAmounts = [];

        for (const entry of timeEntries) {
            if (entry.isNegative) {
                const amount = this._calculateEntryAmount(entry, wageRatesByDate);
                entryAmounts.push({ id: entry.id, paidValue: -amount });
            } else if (entry.isRetro) {
                // retro entries มี paidValue อยู่แล้ว — skip
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
        const current = new Date(startDate);
        while (current <= endDate) {
            const dateStr = toLocalDate(current);
            for (const rate of wageRates) {
                const from = new Date(rate.effectiveFrom);
                const to = rate.effectiveTo ? new Date(rate.effectiveTo) : new Date('2099-12-31');
                if (current >= from && current <= to) {
                    rateMap.set(dateStr, rate);
                    break;
                }
            }
            current.setDate(current.getDate() + 1);
        }

        return rateMap;
    }

    _buildPayrollSummary(payroll, dailyRate) {
        const entries = payroll.payrollRelates.map((r) => r.timeEntry);

        let regularAmount = 0;
        let otAmount = 0;
        let accommodationAmount = 0;
        let regularEffectiveMinutes = 0;
        const otMinutes = { '1': 0, '1.5': 0, '2': 0, '3': 0 };
        let deductionAmount = 0;
        let retroAmount = 0;

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
                        let effective = Math.round(
                            (entry.endTime.getTime() - entry.startTime.getTime()) / 60000,
                        );
                        // กะข้ามวัน — ชดเชย 24 ชม. เมื่อผลต่างติดลบ
                        if (effective < 0) effective += 24 * 60;
                        if (entry.shiftType === 'REGULAR') {
                            const startMin = entry.startTime.getHours() * 60 + entry.startTime.getMinutes();
                            const endMin = entry.endTime.getHours() * 60 + entry.endTime.getMinutes();
                            const overlapStart = Math.max(startMin, 720);
                            const overlapEnd = Math.min(endMin, 780);
                            if (overlapStart < overlapEnd) {
                                effective -= (overlapEnd - overlapStart);
                            }
                        }
                        regularEffectiveMinutes += Math.max(0, effective);
                    }
                } else if (entry.workType === 'OVERTIME') {
                    otAmount += paidValue;
                    const rateKey = String(Number(entry.otRate) || 1);
                    if (entry.endTime) {
                        let minutes = Math.round(
                            (entry.endTime.getTime() - entry.startTime.getTime()) / 60000,
                        );
                        // กะข้ามวัน — ชดเชย 24 ชม. เมื่อผลต่างติดลบ
                        if (minutes < 0) minutes += 24 * 60;
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

        const sso = Number(payroll.ssoAmount) || 0;
        const slf = Number(payroll.slfAmount) || 0;
        const other = Number(payroll.otherDeduction) || 0;

        const netPay = Math.round(
            (regularAmount + otAmount + accommodationAmount + retroAmount - deductionAmount - sso - slf - other) * 100,
        ) / 100;

        const workingDays = Math.round((regularEffectiveMinutes / 480) * 1000) / 1000;

        return {
            dailyRate: dailyRate.dailyRate || 0,
            regularAmount: Math.round(regularAmount * 100) / 100,
            otAmount: Math.round(otAmount * 100) / 100,
            accommodationAmount: Math.round(accommodationAmount * 100) / 100,
            deductionAmount: Math.round(deductionAmount * 100) / 100,
            retroAmount: Math.round(retroAmount * 100) / 100,
            workingDays,
            overtimeMinutes: otMinutes,
            netPay,
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

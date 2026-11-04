import { Op } from "sequelize";

import { sequelize, Payroll, PayrollRelate, TimeEntry } from "../database/index.js";
import err from "../utils/error.js";
import { nextMidnight } from "../utils/date.js";
import employeeService from "./employee.service.js";
import payPeriodService from "./pay-period.service.js";

class PayrollService {
    constructor() {}

    /**
     * Gate การ mutate payroll (docs/PAYROLL-EXPORT-LOCK-PLAN.md กติกา #2, #3)
     * - รอบ CLOSED → 400 ห้ามแก้ทุกกรณี (ต้อง reopen ก่อน)
     * - payroll CALCULATED (export ไปแล้ว) → 409 จนกว่าส่ง allowExported
     * @param {Object} payroll - ต้อง include payPeriod (status) และมี payRef
     * @param {{ allowExported?: boolean }} options
     */
    _assertMutable(payroll, { allowExported = false } = {}) {
        if (payroll.payPeriod?.status === 'CLOSED') {
            throw err.badRequest(null, 'รอบจ่ายปิดแล้ว ไม่สามารถแก้ไขได้ (ใช้เปิดรอบใหม่ก่อน)');
        }
        if (payroll.status === 'CALCULATED' && !allowExported) {
            throw err.conflict(
                { payRef: payroll.payRef },
                'รายการนี้ส่งออกไฟล์แล้ว หากส่งไฟล์ให้ธนาคารไปแล้ว การแก้ไขจะทำให้ยอดไม่ตรงกัน (ส่ง allowExported เพื่อยืนยัน)',
            );
        }
    }

    async getPayrolls({ page, limit, sort, sortBy, payPeriodId, employeeId, status, year, employeeType }) {
        const where = {};

        if (payPeriodId) where.payPeriodId = payPeriodId;
        if (employeeId) where.employeeId = employeeId;
        if (status) where.status = status;

        // filter ผ่าน relation payPeriod (แทน where.payPeriod = {...} ของ Prisma)
        // ด้วย include.where + required — เทียบเท่า relation filter แบบ to-one
        const payPeriodInclude = {
            association: 'payPeriod',
            attributes: ['id', 'periodNo', 'year', 'employeeType'],
        };
        if (year || employeeType) {
            payPeriodInclude.where = {};
            if (year) payPeriodInclude.where.year = year;
            if (employeeType) payPeriodInclude.where.employeeType = employeeType;
            payPeriodInclude.required = true;
        }

        const { rows, count: total } = await Payroll.findAndCountAll({
            where,
            include: [
                payPeriodInclude,
                {
                    association: 'employee',
                    attributes: ['id', 'firstName', 'lastName', 'bankAccount'],
                },
            ],
            distinct: true,
            offset: (page - 1) * limit,
            limit,
            order: [[sortBy, sort]],
        });

        // นับ payrollRelates ต่อ payroll — แทน _count { select: { payrollRelates: true } }
        const relateCounts = await this._countRelatesByPayroll(rows.map((p) => p.id));

        const data = rows.map((p) => ({
            ...p.toJSON(),
            _count: { payrollRelates: relateCounts.get(p.id) ?? 0 },
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

    async getPayrollById(id) {
        const payroll = await Payroll.findByPk(id, {
            include: [
                {
                    association: 'employee',
                    attributes: ['id', 'firstName', 'lastName', 'idCard', 'phone', 'bankAccount', 'shiftType'],
                },
                {
                    association: 'payPeriod',
                    attributes: ['id', 'periodNo', 'year', 'employeeType', 'startDate', 'endDate', 'status'],
                },
                {
                    association: 'payrollRelates',
                    include: {
                        association: 'timeEntry',
                        // field list ตาม prismaSelectDefault.timeEntry เดิม
                        attributes: [
                            'id', 'employeeId', 'startTime', 'endTime', 'shiftType', 'workType',
                            'status', 'otRate', 'accommodation', 'note', 'isNegative', 'isRetro',
                            'paidValue', 'paidDate', 'referenceEntryId',
                        ],
                        include: {
                            association: 'employee',
                            attributes: ['id', 'firstName', 'lastName'],
                        },
                    },
                },
            ],
            order: [[{ model: PayrollRelate, as: 'payrollRelates' }, 'createdAt', 'ASC']],
        });

        if (!payroll) throw err.notFound({ id }, 'ไม่พบรายการจ่ายเงิน');

        return payroll.toJSON();
    }

    async updatePayroll(id, data, { allowExported = false } = {}) {
        const payroll = await Payroll.findByPk(id, {
            include: { association: 'payPeriod', attributes: ['status'] },
        });
        if (!payroll) throw err.notFound({ id }, 'ไม่พบรายการจ่ายเงิน');

        if (payroll.status === 'PAID' || payroll.status === 'CANCELLED') {
            throw err.badRequest(null, 'รายการนี้ไม่สามารถแก้ไขได้');
        }
        this._assertMutable(payroll, { allowExported });

        const updated = await payroll.update({
            ...(data.ssoAmount !== undefined && { ssoAmount: data.ssoAmount }),
            ...(data.slfAmount !== undefined && { slfAmount: data.slfAmount }),
            ...(data.otherDeduction !== undefined && { otherDeduction: data.otherDeduction }),
        });

        return updated.toJSON();
    }

    async cancelPayroll(id, { allowExported = false } = {}) {
        const payroll = await Payroll.findByPk(id, {
            include: { association: 'payPeriod', attributes: ['status'] },
        });
        if (!payroll) throw err.notFound({ id }, 'ไม่พบรายการจ่ายเงิน');

        if (payroll.status !== 'PENDING' && payroll.status !== 'CALCULATED') {
            throw err.badRequest(null, 'รายการนี้ไม่สามารถยกเลิกได้');
        }
        this._assertMutable(payroll, { allowExported });

        await sequelize.transaction(async (t) => {
            // ดึง timeEntryIds ที่เกี่ยวข้อง
            const relates = await PayrollRelate.findAll({
                where: { payrollId: id },
                attributes: ['timeEntryId'],
                transaction: t,
            });

            if (relates.length > 0) {
                const entryIds = relates.map((r) => r.timeEntryId);

                // ลบ relates
                await PayrollRelate.destroy({ where: { payrollId: id }, transaction: t });

                // คืนสถานะ time entry → DRAFT, paidValue = null
                await TimeEntry.update(
                    { status: 'DRAFT', paidValue: null },
                    { where: { id: { [Op.in]: entryIds } }, transaction: t },
                );
            }

            await Payroll.update(
                { status: 'CANCELLED' },
                { where: { id }, transaction: t },
            );
        });

        return { message: 'ยกเลิกรายการจ่ายเงินสำเร็จ' };
    }

    async recalculatePayroll(id, { allowExported = false } = {}) {
        const payroll = await Payroll.findByPk(id, {
            include: {
                association: 'payPeriod',
                attributes: ['startDate', 'endDate', 'employeeType', 'status'],
            },
        });
        if (!payroll) throw err.notFound({ id }, 'ไม่พบรายการจ่ายเงิน');

        if (payroll.status !== 'PENDING' && payroll.status !== 'CALCULATED') {
            throw err.badRequest(null, 'รายการนี้ไม่สามารถคำนวณใหม่ได้');
        }
        this._assertMutable(payroll, { allowExported });

        const { startDate, endDate } = payroll.payPeriod;

        // Carryover: correction/retro จากรอบก่อน (business rule เดียวกับ createPayrolls)
        const lookbackDays = Number(process.env.PAYROLL_LOOKBACK_DAYS || 90);
        const lookbackStart = new Date(startDate);
        lookbackStart.setDate(lookbackStart.getDate() - lookbackDays);

        const result = await sequelize.transaction(async (t) => {
            // ดึง time entries ของพนักงานในรอบนี้
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
                        payrollId: { [Op.ne]: id },
                    },
                    attributes: ['timeEntryId'],
                    transaction: t,
                })
                : [];
            const otherLinkedIds = new Set(otherLinks.map((r) => r.timeEntryId));
            const timeEntries = combined.filter((e) => !otherLinkedIds.has(e.id));

            // เปรียบเทียบกับ relates ที่มีอยู่
            const existingRelates = await PayrollRelate.findAll({
                where: { payrollId: id },
                attributes: ['timeEntryId'],
                transaction: t,
            });
            const linkedIds = new Set(existingRelates.map((r) => r.timeEntryId));

            const newEntries = timeEntries.filter((e) => !linkedIds.has(e.id));

            // เพิ่ม relate ใหม่ + LOCK สถานะให้สอดคล้องกับ createPayrolls
            if (newEntries.length > 0) {
                await PayrollRelate.bulkCreate(
                    newEntries.map((entry) => ({
                        payrollId: id,
                        timeEntryId: entry.id,
                    })),
                    { transaction: t },
                );
                await TimeEntry.update(
                    { status: 'LOCKED' },
                    { where: { id: newEntries.map((e) => e.id) }, transaction: t },
                );
            }

            // คำนวณ paidValue ใหม่ (wage map จาก lookbackStart เพื่อคำนวณ correction
            // ด้วยอัตราของวันที่ entry ต้นฉบับ)
            const wageRatesByDate = await payPeriodService._getWageRatesByDate(
                payroll.employeeId, lookbackStart, endDate, t,
            );

            // worker: นาทีลารายวันมาเติมวันทำงาน (spec section C)
            const leavesByDate = payroll.payPeriod.employeeType === 'WORKER'
                ? await payPeriodService._getLeaveMinutesByDate(payroll.employeeId, startDate, endDate, t)
                : new Map();

            const entryAmounts = payPeriodService._calculatePayrollAmounts(
                timeEntries, wageRatesByDate,
                { employeeType: payroll.payPeriod.employeeType, leavesByDate },
            );

            // bulk update paidValue
            if (entryAmounts.length > 0) {
                await payPeriodService._bulkUpdatePaidValue(entryAmounts, t);
            }

            // คำนวณยอดหัก SSO ใหม่ตามสูตรเสมอ (ทับการแก้มือ — docs/SSO-PLAN.md)
            const ssoWarning = await payPeriodService._computeAndSaveSso(payroll, {
                employeeType: payroll.payPeriod.employeeType,
                periodStartDate: startDate,
                periodEndDate: endDate,
                wageRatesByDate,
            }, t);

            return {
                id,
                entryCount: timeEntries.length,
                newEntries: newEntries.length,
                warnings: ssoWarning ? [ssoWarning] : [],
            };
        });

        return result;
    }

    async calculateRetroactive(params) {
        return employeeService.calculateRetroactive(params);
    }

    // ─── Private Helpers ───────────────────────────────────────

    /**
     * นับ payrollRelates แยกตาม payrollId
     * (ทดแทน _count { select: { payrollRelates: true } } ของ Prisma)
     * @param {number[]} payrollIds
     * @returns {Promise<Map<number, number>>}
     */
    async _countRelatesByPayroll(payrollIds) {
        const counts = new Map();
        if (!payrollIds || payrollIds.length === 0) {
            return counts;
        }

        const rows = await PayrollRelate.findAll({
            where: { payrollId: { [Op.in]: payrollIds } },
            attributes: [
                'payrollId',
                [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
            ],
            group: ['payroll_id'],
            raw: true,
        });

        for (const row of rows) {
            // raw: true คืน key เป็นชื่อคอลัมน์ได้ — รองรับทั้งสองแบบกันเหนียว
            const pid = Number(row.payrollId ?? row.payroll_id);
            counts.set(pid, Number(row.count));
        }

        return counts;
    }
}

export default new PayrollService();

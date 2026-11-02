import { Op } from "sequelize";

import { sequelize, Payroll, PayrollRelate, TimeEntry } from "../database/index.js";
import err from "../utils/error.js";
import employeeService from "./employee.service.js";
import payPeriodService from "./pay-period.service.js";

class PayrollService {
    constructor() {}

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

    async updatePayroll(id, data) {
        const payroll = await Payroll.findByPk(id);
        if (!payroll) throw err.notFound({ id }, 'ไม่พบรายการจ่ายเงิน');

        if (payroll.status === 'PAID' || payroll.status === 'CANCELLED') {
            throw err.badRequest(null, 'รายการนี้ไม่สามารถแก้ไขได้');
        }

        const updated = await payroll.update({
            ...(data.ssoAmount !== undefined && { ssoAmount: data.ssoAmount }),
            ...(data.slfAmount !== undefined && { slfAmount: data.slfAmount }),
            ...(data.otherDeduction !== undefined && { otherDeduction: data.otherDeduction }),
        });

        return updated.toJSON();
    }

    async cancelPayroll(id) {
        const payroll = await Payroll.findByPk(id);
        if (!payroll) throw err.notFound({ id }, 'ไม่พบรายการจ่ายเงิน');

        if (payroll.status !== 'PENDING' && payroll.status !== 'CALCULATED') {
            throw err.badRequest(null, 'รายการนี้ไม่สามารถยกเลิกได้');
        }

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

    async recalculatePayroll(id) {
        const payroll = await Payroll.findByPk(id, {
            include: {
                association: 'payPeriod',
                attributes: ['startDate', 'endDate'],
            },
        });
        if (!payroll) throw err.notFound({ id }, 'ไม่พบรายการจ่ายเงิน');

        if (payroll.status !== 'PENDING' && payroll.status !== 'CALCULATED') {
            throw err.badRequest(null, 'รายการนี้ไม่สามารถคำนวณใหม่ได้');
        }

        const { startDate, endDate } = payroll.payPeriod;

        const result = await sequelize.transaction(async (t) => {
            // ดึง LOCKED time entries ของพนักงานในรอบนี้ (ที่ยังไม่มี paidDate)
            const timeEntries = await TimeEntry.findAll({
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

            // คำนวณ paidValue ใหม่
            const wageRatesByDate = await payPeriodService._getWageRatesByDate(
                payroll.employeeId, startDate, endDate, t,
            );
            const entryAmounts = payPeriodService._calculatePayrollAmounts(
                timeEntries, wageRatesByDate,
            );

            // bulk update paidValue
            if (entryAmounts.length > 0) {
                await payPeriodService._bulkUpdatePaidValue(entryAmounts, t);
            }

            return {
                id,
                entryCount: timeEntries.length,
                newEntries: newEntries.length,
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

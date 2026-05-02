import prisma from "../databases/prisma.js";
import { Prisma } from "../../prisma/generated/prisma/client.ts";
import err from "../utils/error.js";
import prismaSelectDefault from "../utils/prismaSelectDefault.js";
import employeeService from "./employee.service.js";
import payPeriodService from "./pay-period.service.js";
import { toLocalDate } from "../utils/date.js";

class PayrollService {
    constructor() {}

    async getPayrolls({ page, limit, sort, sortBy, payPeriodId, employeeId, status, year, employeeType }) {
        const where = {};

        if (payPeriodId) where.payPeriodId = payPeriodId;
        if (employeeId) where.employeeId = employeeId;
        if (status) where.status = status;

        if (year || employeeType) {
            where.payPeriod = {};
            if (year) where.payPeriod.year = year;
            if (employeeType) where.payPeriod.employeeType = employeeType;
        }

        const orderBy = {};
        orderBy[sortBy] = sort;

        const [data, total] = await Promise.all([
            prisma.payroll.findMany({
                where,
                orderBy,
                skip: (page - 1) * limit,
                take: limit,
                include: {
                    employee: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            bankAccount: true,
                        },
                    },
                    payPeriod: {
                        select: {
                            id: true,
                            periodNo: true,
                            year: true,
                            employeeType: true,
                        },
                    },
                    _count: {
                        select: { payrollRelates: true },
                    },
                },
            }),
            prisma.payroll.count({ where }),
        ]);

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
        const payroll = await prisma.payroll.findUnique({
            where: { id },
            include: {
                employee: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        idCard: true,
                        phone: true,
                        bankAccount: true,
                        shiftType: true,
                    },
                },
                payPeriod: {
                    select: {
                        id: true,
                        periodNo: true,
                        year: true,
                        employeeType: true,
                        startDate: true,
                        endDate: true,
                        status: true,
                    },
                },
                payrollRelates: {
                    include: {
                        timeEntry: {
                            select: prismaSelectDefault.timeEntry,
                        },
                    },
                    orderBy: { createdAt: 'asc' },
                },
            },
        });

        if (!payroll) throw err.notFound({ id }, 'ไม่พบรายการจ่ายเงิน');

        return payroll;
    }

    async updatePayroll(id, data) {
        const payroll = await prisma.payroll.findUnique({ where: { id } });
        if (!payroll) throw err.notFound({ id }, 'ไม่พบรายการจ่ายเงิน');

        if (payroll.status === 'PAID' || payroll.status === 'CANCELLED') {
            throw err.badRequest(null, 'รายการนี้ไม่สามารถแก้ไขได้');
        }

        const updated = await prisma.payroll.update({
            where: { id },
            data: {
                ...(data.ssoAmount !== undefined && { ssoAmount: data.ssoAmount }),
                ...(data.slfAmount !== undefined && { slfAmount: data.slfAmount }),
                ...(data.otherDeduction !== undefined && { otherDeduction: data.otherDeduction }),
            },
        });

        return updated;
    }

    async cancelPayroll(id) {
        const payroll = await prisma.payroll.findUnique({
            where: { id },
            include: { payPeriod: { select: { startDate: true, endDate: true } } },
        });
        if (!payroll) throw err.notFound({ id }, 'ไม่พบรายการจ่ายเงิน');

        if (payroll.status !== 'PENDING' && payroll.status !== 'CALCULATED') {
            throw err.badRequest(null, 'รายการนี้ไม่สามารถยกเลิกได้');
        }

        await prisma.$transaction(async (tx) => {
            // ดึง timeEntryIds ที่เกี่ยวข้อง
            const relates = await tx.payrollRelate.findMany({
                where: { payrollId: id },
                select: { timeEntryId: true },
            });

            if (relates.length > 0) {
                const entryIds = relates.map(r => r.timeEntryId);

                // ลบ relates
                await tx.payrollRelate.deleteMany({ where: { payrollId: id } });

                // คืนสถานะ time entry → DRAFT, paidValue = null
                await tx.timeEntry.updateMany({
                    where: { id: { in: entryIds } },
                    data: { status: 'DRAFT', paidValue: null },
                });
            }

            await tx.payroll.update({
                where: { id },
                data: { status: 'CANCELLED' },
            });
        });

        return { message: 'ยกเลิกรายการจ่ายเงินสำเร็จ' };
    }

    async recalculatePayroll(id) {
        const payroll = await prisma.payroll.findUnique({
            where: { id },
            include: { payPeriod: { select: { startDate: true, endDate: true } } },
        });
        if (!payroll) throw err.notFound({ id }, 'ไม่พบรายการจ่ายเงิน');

        if (payroll.status !== 'PENDING' && payroll.status !== 'CALCULATED') {
            throw err.badRequest(null, 'รายการนี้ไม่สามารถคำนวณใหม่ได้');
        }

        const { startDate, endDate } = payroll.payPeriod;

        const result = await prisma.$transaction(async (tx) => {
            // ดึง LOCKED time entries ของพนักงานในรอบนี้ (ที่ยังไม่มี paidDate)
            const timeEntries = await tx.timeEntry.findMany({
                where: {
                    employeeId: payroll.employeeId,
                    startTime: { gte: startDate, lte: endDate },
                },
                orderBy: { startTime: 'asc' },
            });

            // เปรียบเทียบกับ relates ที่มีอยู่
            const existingRelates = await tx.payrollRelate.findMany({
                where: { payrollId: id },
                select: { timeEntryId: true },
            });
            const linkedIds = new Set(existingRelates.map(r => r.timeEntryId));

            const newEntries = timeEntries.filter(e => !linkedIds.has(e.id));

            // เพิ่ม relate ใหม่
            if (newEntries.length > 0) {
                await tx.payrollRelate.createMany({
                    data: newEntries.map(entry => ({
                        payrollId: id,
                        timeEntryId: entry.id,
                    })),
                });
            }

            // คำนวณ summary + paidValue ใหม่
            const wageRatesByDate = await payPeriodService._getWageRatesByDate(
                payroll.employeeId, startDate, endDate, tx,
            );
            const { entryAmounts, ...payrollData } = payPeriodService._calculatePayrollAmounts(
                timeEntries, wageRatesByDate,
            );

            // bulk update paidValue
            if (entryAmounts.length > 0) {
                await tx.$executeRaw`
                    UPDATE time_entries
                    SET paid_value = data.paid_value::numeric
                    FROM (VALUES ${Prisma.join(
                        entryAmounts.map(e => Prisma.sql`(${e.id}, ${e.paidValue})`)
                    )}) AS data(id, paid_value)
                    WHERE time_entries.id = data.id::integer
                `;
            }

            // อัปเดต payroll summary
            const updated = await tx.payroll.update({
                where: { id },
                data: payrollData,
            });

            return {
                ...updated,
                entryCount: timeEntries.length,
                newEntries: newEntries.length,
            };
        });

        return result;
    }

    async calculateRetroactive(params) {
        return employeeService.calculateRetroactive(params);
    }
}

export default new PayrollService();

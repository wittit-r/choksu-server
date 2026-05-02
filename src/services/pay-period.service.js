import prisma from "../databases/prisma.js";
import { Prisma } from "../../prisma/generated/prisma/client.ts";
import err from "../utils/error.js";
import prismaSelectDefault from "../utils/prismaSelectDefault.js";
import { toLocalDate } from "../utils/date.js";

class PayPeriodService {
    constructor() {}

    // ─── Public Methods ────────────────────────────────────────

    async getPayPeriods({ page, limit, sort, sortBy, year, employeeType, status }) {
        const where = {};
        if (year) where.year = year;
        if (employeeType) where.employeeType = employeeType;
        if (status) where.status = status;

        const orderBy = {};
        orderBy[sortBy] = sort;

        const [data, total] = await Promise.all([
            prisma.payPeriod.findMany({
                where,
                orderBy,
                skip: (page - 1) * limit,
                take: limit,
                include: {
                    _count: {
                        select: { payrolls: true },
                    },
                },
            }),
            prisma.payPeriod.count({ where }),
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

    async getPayPeriodById(id) {
        const payPeriod = await prisma.payPeriod.findUnique({
            where: { id },
            include: {
                payrolls: {
                    where: { status: { not: 'CANCELLED' } },
                    orderBy: { id: 'asc' },
                    include: {
                        employee: {
                            select: {
                                id: true,
                                firstName: true,
                                lastName: true,
                                bankAccount: true,
                            },
                        },
                        _count: {
                            select: { payrollRelates: true },
                        },
                    },
                },
            },
        });

        if (!payPeriod) throw err.notFound({ id }, 'ไม่พบรอบจ่ายเงิน');

        return payPeriod;
    }

    async createPayPeriod({ periodNo, year, employeeType, startDate, endDate }) {
        const existing = await prisma.payPeriod.findFirst({
            where: { year, periodNo, employeeType },
        });

        if (existing) {
            throw err.conflict(
                { year, periodNo, employeeType },
                'รอบจ่ายนี้มีอยู่แล้ว',
            );
        }

        const payPeriod = await prisma.payPeriod.create({
            data: {
                periodNo,
                year,
                employeeType,
                startDate: new Date(startDate),
                endDate: new Date(endDate),
            },
        });

        return payPeriod;
    }

    async createPayrollsForPeriod(payPeriodId, { employeeId: targetEmployeeId } = {}) {
        const payPeriod = await prisma.payPeriod.findUnique({ where: { id: payPeriodId } });
        if (!payPeriod) throw err.notFound({ id: payPeriodId }, 'ไม่พบรอบจ่ายเงิน');
        if (payPeriod.status !== 'OPEN') {
            throw err.badRequest(null, 'รอบจ่ายไม่อยู่ในสถานะเปิด ไม่สามารถสร้างรายการจ่ายได้');
        }

        const { startDate, endDate, employeeType } = payPeriod;

        // ถ้าระบุ employeeId → ตรวจสอบว่ายังไม่มี payroll ของคนนี้ใน period นี้
        if (targetEmployeeId) {
            const existing = await prisma.payroll.findFirst({
                where: {
                    payPeriodId,
                    employeeId: targetEmployeeId,
                    status: { not: 'CANCELLED' },
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
        const entryWhere = {
            timeSheet: { status: 'FILLED' },
            status: 'DRAFT',
            isNegative: false,
            isRetro: false,
            startTime: { gte: startDate, lte: endDate },
        };

        const employeesWithEntries = await prisma.timeEntry.findMany({
            where: entryWhere,
            select: { employeeId: true },
            distinct: ['employeeId'],
        });

        if (employeesWithEntries.length === 0) {
            return { created: 0, skipped: 0, payrolls: [] };
        }

        const candidateEmployeeIds = employeesWithEntries.map(e => e.employeeId);

        // 2. filter เฉพาะ employee ที่ตรงกับ employeeType
        const employees = await prisma.employee.findMany({
            where: {
                id: {
                    in: targetEmployeeId
                        ? candidateEmployeeIds.filter(id => id === targetEmployeeId)
                        : candidateEmployeeIds,
                },
                isActive: true,
                wageRates: {
                    some: {
                        position: { employeeType },
                        effectiveFrom: { lte: endDate },
                        OR: [
                            { effectiveTo: null },
                            { effectiveTo: { gte: startDate } },
                        ],
                    },
                },
            },
            select: { id: true },
        });

        if (employees.length === 0) {
            return { created: 0, skipped: 0, payrolls: [] };
        }

        const validEmployeeIds = employees.map(e => e.id);

        // 3. ดึง timeEntryIds ที่ linked อยู่แล้ว
        const alreadyLinked = await prisma.payrollRelate.findMany({
            where: {
                timeEntry: {
                    startTime: { gte: startDate, lte: endDate },
                    employeeId: { in: validEmployeeIds },
                },
            },
            select: { timeEntryId: true },
        });
        const linkedEntryIds = new Set(alreadyLinked.map(r => r.timeEntryId));

        // 4. Transaction: สร้าง Payroll + PayrollRelate
        const results = await prisma.$transaction(async (tx) => {
            let seq = await tx.payroll.count({
                where: { payPeriodId },
            });

            const createdPayrolls = [];

            for (const employeeId of validEmployeeIds) {
                // ดึง time entries ที่ยังไม่ linked (FILLED + DRAFT only)
                const timeEntries = await tx.timeEntry.findMany({
                    where: {
                        employeeId,
                        timeSheet: { status: 'FILLED' },
                        status: 'DRAFT',
                        startTime: { gte: startDate, lte: endDate },
                        ...(linkedEntryIds.size > 0 && {
                            id: { notIn: Array.from(linkedEntryIds) },
                        }),
                    },
                    orderBy: { startTime: 'asc' },
                });

                if (timeEntries.length === 0) continue;

                // ดึง wage rates
                const wageRatesByDate = await this._getWageRatesByDate(
                    employeeId, startDate, endDate, tx,
                );

                // คำนวณ summary
                const { entryAmounts, ...payrollData } = this._calculatePayrollAmounts(timeEntries, wageRatesByDate);

                // บันทึก paidValue ลง time entry (bulk update)
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

                // ปรับ time entry status → LOCKED
                const entryIds = timeEntries.map(e => e.id);
                await tx.timeEntry.updateMany({
                    where: { id: { in: entryIds } },
                    data: { status: 'LOCKED' },
                });

                seq++;
                const payRef = this._generatePayRef(payPeriod.year, payPeriod.periodNo, seq);

                const payroll = await tx.payroll.create({
                    data: {
                        payRef,
                        employeeId,
                        payPeriodId,
                        ...payrollData,
                    },
                });

                // สร้าง PayrollRelate
                const relateData = timeEntries.map(entry => ({
                    payrollId: payroll.id,
                    timeEntryId: entry.id,
                }));

                await tx.payrollRelate.createMany({ data: relateData });

                createdPayrolls.push({
                    ...payroll,
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
        const payPeriod = await prisma.payPeriod.findUnique({ where: { id: payPeriodId } });
        if (!payPeriod) throw err.notFound({ id: payPeriodId }, 'ไม่พบรอบจ่ายเงิน');
        if (payPeriod.status !== 'OPEN') {
            throw err.badRequest(null, 'รอบจ่ายไม่อยู่ในสถานะเปิด ไม่สามารถยกเลิกได้');
        }

        const payrolls = await prisma.payroll.findMany({
            where: {
                payPeriodId,
                status: { in: ['PENDING', 'CALCULATED'] },
            },
            select: { id: true },
        });

        if (payrolls.length === 0) {
            return { cancelled: 0, message: 'ไม่มีรายการจ่ายเงินที่สามารถยกเลิกได้' };
        }

        const payrollIds = payrolls.map(p => p.id);

        await prisma.$transaction(async (tx) => {
            // ดึง timeEntryIds ที่เกี่ยวข้องกับ payrolls เหล่านี้
            const relates = await tx.payrollRelate.findMany({
                where: { payrollId: { in: payrollIds } },
                select: { timeEntryId: true },
            });

            if (relates.length > 0) {
                const entryIds = relates.map(r => r.timeEntryId);

                // ลบ relates
                await tx.payrollRelate.deleteMany({
                    where: { payrollId: { in: payrollIds } },
                });

                // คืนสถานะ time entry → DRAFT, paidValue = null
                await tx.timeEntry.updateMany({
                    where: { id: { in: entryIds } },
                    data: { status: 'DRAFT', paidValue: null },
                });
            }

            // ยกเลิก payroll ทั้งหมด
            await tx.payroll.updateMany({
                where: { id: { in: payrollIds } },
                data: { status: 'CANCELLED' },
            });
        });

        return { cancelled: payrollIds.length, message: `ยกเลิกรายการจ่ายเงิน ${payrollIds.length} รายการสำเร็จ` };
    }

    async recalculatePayPeriod(payPeriodId) {
        const payPeriod = await prisma.payPeriod.findUnique({ where: { id: payPeriodId } });
        if (!payPeriod) throw err.notFound({ id: payPeriodId }, 'ไม่พบรอบจ่ายเงิน');

        const { startDate, endDate } = payPeriod;

        // ดึง payrolls ที่ยังไม่ PAID และไม่ CANCELLED
        const payrolls = await prisma.payroll.findMany({
            where: {
                payPeriodId,
                status: { in: ['PENDING', 'CALCULATED'] },
            },
            include: {
                _count: { select: { payrollRelates: true } },
            },
        });

        if (payrolls.length === 0) {
            return { updated: 0, payrolls: [] };
        }

        const results = await prisma.$transaction(async (tx) => {
            const updated = [];

            for (const payroll of payrolls) {
                // ดึง time entries ที่เกี่ยวข้องทั้งหมดในช่วงเวลา (รวม negative และ retro)
                const timeEntries = await tx.timeEntry.findMany({
                    where: {
                        employeeId: payroll.employeeId,
                        startTime: { gte: startDate, lte: endDate },
                    },
                    orderBy: { startTime: 'asc' },
                });

                // ตรวจสอบ time entries ใหม่ที่ยังไม่ linked
                const existingRelates = await tx.payrollRelate.findMany({
                    where: { payrollId: payroll.id },
                    select: { timeEntryId: true },
                });
                const linkedIds = new Set(existingRelates.map(r => r.timeEntryId));

                const newEntries = timeEntries.filter(e => !linkedIds.has(e.id));

                // เพิ่ม relate ใหม่
                if (newEntries.length > 0) {
                    await tx.payrollRelate.createMany({
                        data: newEntries.map(entry => ({
                            payrollId: payroll.id,
                            timeEntryId: entry.id,
                        })),
                    });
                }

                // คำนวณ summary ใหม่จากทุก entry (รวมเก่า + ใหม่)
                const wageRatesByDate = await this._getWageRatesByDate(
                    payroll.employeeId, startDate, endDate, tx,
                );
                const { entryAmounts, ...payrollData } = this._calculatePayrollAmounts(timeEntries, wageRatesByDate);

                // อัปเดต paidValue ลง time entry (bulk update)
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

                const updatedPayroll = await tx.payroll.update({
                    where: { id: payroll.id },
                    data: payrollData,
                });

                updated.push({
                    ...updatedPayroll,
                    entryCount: timeEntries.length,
                    newEntries: newEntries.length,
                });
            }

            return updated;
        });

        return { updated: results.length, payrolls: results };
    }

    async reopenPayPeriod(payPeriodId) {
        const payPeriod = await prisma.payPeriod.findUnique({ where: { id: payPeriodId } });
        if (!payPeriod) throw err.notFound({ id: payPeriodId }, 'ไม่พบรอบจ่ายเงิน');
        if (payPeriod.status !== 'CLOSED') {
            throw err.badRequest(null, 'รอบจ่ายไม่อยู่ในสถานะปิด ไม่สามารถเปิดใหม่ได้');
        }

        return await prisma.payPeriod.update({
            where: { id: payPeriodId },
            data: { status: 'OPEN' },
        });
    }

    async exportPayPeriod(payPeriodId) {
        const payPeriod = await prisma.payPeriod.findUnique({ where: { id: payPeriodId } });
        if (!payPeriod) throw err.notFound({ id: payPeriodId }, 'ไม่พบรอบจ่ายเงิน');
        if (payPeriod.status !== 'OPEN') {
            throw err.badRequest(null, 'รอบจ่ายไม่อยู่ในสถานะเปิด');
        }

        // //TODO - Generate Excel file
        // const buffer = await this._generateExcelFile(payPeriodId);

        const { count } = await prisma.payroll.updateMany({
            where: {
                payPeriodId,
                status: 'PENDING',
            },
            data: { status: 'CALCULATED' },
        });

        return {
            message: 'Export successful (TODO: Excel generation)',
            data: { updatedCount: count },
        };
    }

    async closePayPeriod(payPeriodId, { force = false } = {}) {
        const payPeriod = await prisma.payPeriod.findUnique({ where: { id: payPeriodId } });
        if (!payPeriod) throw err.notFound({ id: payPeriodId }, 'ไม่พบรอบจ่ายเงิน');
        if (payPeriod.status !== 'OPEN') {
            throw err.badRequest(null, 'รอบจ่ายไม่อยู่ในสถานะเปิด ไม่สามารถปิดได้');
        }

        const pendingCount = await prisma.payroll.count({
            where: { payPeriodId, status: 'PENDING' },
        });

        if (pendingCount > 0 && !force) {
            throw err.badRequest(
                { pendingPayrollCount: pendingCount },
                `มีรายการจ่าย ${pendingCount} รายการที่ยังไม่ได้ export กรุณา export ก่อนปิดรอบ หรือใช้ force=true`,
            );
        }

        const updated = await prisma.payPeriod.update({
            where: { id: payPeriodId },
            data: { status: 'CLOSED' },
        });

        return {
            message: pendingCount > 0
                ? `ปิดรอบจ่ายสำเร็จ (มีรายการ PENDING ที่ถูกข้าม ${pendingCount} รายการ)`
                : 'ปิดรอบจ่ายสำเร็จ',
            data: updated,
        };
    }

    // //TODO - Parse bank file and update payroll status to PAID
    async importBankFile(payPeriodId) {
        const payPeriod = await prisma.payPeriod.findUnique({ where: { id: payPeriodId } });
        if (!payPeriod) throw err.notFound({ id: payPeriodId }, 'ไม่พบรอบจ่ายเงิน');
        if (payPeriod.status === 'CLOSED') {
            throw err.badRequest(null, 'รอบจ่ายปิดแล้ว ไม่สามารถนำเข้าไฟล์ธนาคารได้');
        }

        return { message: 'TODO: Bank import not implemented' };
    }

    // ─── Private Helpers ───────────────────────────────────────

    _calculatePayrollAmounts(timeEntries, wageRatesByDate) {
        let summaryRegularAmount = 0;
        let summaryOtAmount = 0;
        let summaryAccommodationAmount = 0;
        const entryAmounts = [];

        for (const entry of timeEntries) {
            if (entry.isNegative) {
                const amount = this._calculateEntryAmount(entry, wageRatesByDate);
                if (entry.workType === 'REGULAR') summaryRegularAmount -= amount;
                else if (entry.workType === 'OVERTIME') summaryOtAmount -= amount;
                entryAmounts.push({ id: entry.id, paidValue: -amount });
            } else if (entry.isRetro) {
                const retroValue = Number(entry.paidValue || 0);
                if (entry.workType === 'REGULAR') summaryRegularAmount += retroValue;
                else if (entry.workType === 'OVERTIME') summaryOtAmount += retroValue;
            } else {
                if (entry.workType === 'ACCOMMODATION') {
                    const accValue = Number(entry.accommodation || 0);
                    summaryAccommodationAmount += accValue;
                    entryAmounts.push({ id: entry.id, paidValue: accValue });
                } else {
                    const amount = this._calculateEntryAmount(entry, wageRatesByDate);
                    if (entry.workType === 'REGULAR') summaryRegularAmount += amount;
                    else if (entry.workType === 'OVERTIME') summaryOtAmount += amount;
                    entryAmounts.push({ id: entry.id, paidValue: amount });
                }
            }
        }

        return {
            summaryRegularAmount: Math.round(summaryRegularAmount * 100) / 100,
            summaryOtAmount: Math.round(summaryOtAmount * 100) / 100,
            summaryAccommodationAmount: Math.round(summaryAccommodationAmount * 100) / 100,
            entryAmounts,
        };
    }

    _calculateEntryAmount(entry, wageRatesByDate) {
        const wageRate = wageRatesByDate.get(toLocalDate(entry.startTime));
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
            return fullHours * hourlyRate + remainMinutes * minuteRate;
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

    async _getWageRatesByDate(employeeId, startDate, endDate, tx = prisma) {
        const wageRates = await tx.wageRate.findMany({
            where: {
                employeeId,
                effectiveFrom: { lte: endDate },
                OR: [
                    { effectiveTo: null },
                    { effectiveTo: { gte: startDate } },
                ],
            },
            select: {
                dailyRate: true,
                effectiveFrom: true,
                effectiveTo: true,
            },
            orderBy: { effectiveFrom: 'asc' },
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

    // PAY-YYYY-PP-NNN
    // YYYY: ปี
    // PP: รอบ
    // NNN: ลำดับ
    _generatePayRef(year, periodNo, seq) {
        return `PAY-${year}-${String(periodNo).padStart(2, '0')}-${String(seq).padStart(3, '0')}`;
    }
}

export default new PayPeriodService();

import prisma from "../databases/prisma.js";
import err from "../utils/error.js";
import prismaSelectDefault from "../utils/prismaSelectDefault.js";

class EmployeeService {
    async _validatePositionExists(positionId) {
        const position = await prisma.position.findUnique({
            where: { id: positionId },
            select: { id: true },
        });

        if (!position) {
            throw err.validation({ positionId: 'ไม่พบตำแหน่งงาน' });
        }

        return position;
    }

    async getEmployees({ page, limit, sort, sortBy, ...query }) {
        const where = {};

        if (query.search) {
            where.OR = [
                { firstName: { contains: query.search, mode: 'insensitive' } },
                { lastName: { contains: query.search, mode: 'insensitive' } },
                { idCard: query.search },
                { phone: query.search },
            ];
        }

        if (query.isActive !== undefined) {
            where.isActive = query.isActive;
        }

        if (query.workLeaderId !== undefined) {
            where.workLeaderId = query.workLeaderId;
        }

        if (query.branchId !== undefined) {
            where.workLeader = {
                branchId: query.branchId,
            };
        }

        const [ employees, total ] = await Promise.all([
            prisma.employee.findMany({
                where,
                select: {
                    ...prismaSelectDefault.employee,
                    workLeader: {
                        select: {
                            id: true,
                            name: true,
                            branch: {
                                select: prismaSelectDefault.branch,
                            }
                        }
                    }
                },
                skip: (page - 1) * limit,
                take: limit,
                orderBy: {
                    [sortBy]: sort,
                },
            }),
            prisma.employee.count({
                where,
            }),
        ]);

        return {
            data: employees,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        };
    }

    async createEmployee({ firstName, lastName, idCard, phone, bankAccount, employeeType, shiftType, positionId, workLeaderId, startDate }) {
        const employee = await prisma.employee.create({
            data: {
                firstName,
                lastName,
                idCard,
                phone,
                bankAccount,
                employeeType,
                shiftType,
                positionId,
                workLeaderId,
                startDate: new Date(startDate),
            },
            select: {
                ...prismaSelectDefault.employee,
                bankAccount: true,
                startDate: true,
                createdAt: true,
                updatedAt: true,
                position: {
                    select: prismaSelectDefault.position,
                },
                workLeader: {
                    select: {
                        id: true,
                        name: true,
                        branch: {
                            select: prismaSelectDefault.branch,
                        }
                    }
                },
            },
        });
        return employee;
    }

    async getEmployeeById({ id }) {
        const employee = await prisma.employee.findUnique({
            where: { id },
            select: {
                ...prismaSelectDefault.employee,
                bankAccount: true,
                startDate: true,
                createdAt: true,
                updatedAt: true,
                position: {
                    select: prismaSelectDefault.position,
                },
                workLeader: {
                    select: {
                        id: true,
                        name: true,
                        branch: {
                            select: prismaSelectDefault.branch,
                        }
                    }
                },
            },
        });

        if (!employee) {
            throw err.notFound({ id });
        }

        return employee;
    }

    async updateEmployee(id, { firstName, lastName, idCard, phone, bankAccount, employeeType, shiftType, positionId, workLeaderId, startDate, isActive }) {
        // ตรวจสอบว่ามี employee อยู่จริง
        const employee = await prisma.employee.findUnique({
            where: { id },
            select: { id: true }, // เช็คเฉพาะ id เพื่อประหยัด resource
        });

        if (!employee) {
            throw err.notFound({ id });
        }

        // อัปเดตเฉพาะฟิลด์ที่ส่งมา และ select เฉพาะฟิลด์ที่ต้องการคืนค่า
        const updated = await prisma.employee.update({
            where: { id },
            data: {
                ...(firstName !== undefined && { firstName }),
                ...(lastName !== undefined && { lastName }),
                ...(idCard !== undefined && { idCard }),
                ...(phone !== undefined && { phone }),
                ...(bankAccount !== undefined && { bankAccount }),
                ...(employeeType !== undefined && { employeeType }),
                ...(shiftType !== undefined && { shiftType }),
                ...(positionId !== undefined && { positionId }),
                ...(workLeaderId !== undefined && { workLeaderId }),
                ...(startDate !== undefined && { startDate }),
                ...(isActive !== undefined && { isActive }),
            },
            select: {
                ...prismaSelectDefault.employee,
                bankAccount: true,
                startDate: true,
                createdAt: true,
                updatedAt: true,
                position: {
                    select: prismaSelectDefault.position,
                },
                workLeader: {
                    select: {
                        id: true,
                        name: true,
                        branch: {
                            select: prismaSelectDefault.branch,
                        }
                    }
                },
            },
        });

        return updated;
    }

    async getWagesByEmployeeId({ employeeId, page, limit, sort, sortBy }) {
        // ตรวจสอบว่า employee มีอยู่จริง
        const employee = await prisma.employee.findUnique({
            where: { id: employeeId },
            select: { id: true },
        });

        if (!employee) {
            throw err.notFound({ employeeId });
        }

        const where = { employeeId };

        const [wages, total] = await Promise.all([
            prisma.wageRate.findMany({
                where,
                select: {
                    ...prismaSelectDefault.wageRate,
                    position: {
                        select: {
                            id: true,
                            name: true,
                            employeeType: true,
                        }
                    }
                },
                skip: (page - 1) * limit,
                take: limit,
                orderBy: {
                    [sortBy]: sort,
                },
            }),
            prisma.wageRate.count({ where }),
        ]);

        return {
            data: wages,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        };
    }

    async createWage({ employeeId, positionId, dailyRate, hourlyRate, minuteRate, monthlyRate, effectiveFrom, effectiveTo, note }) {
        // ตรวจสอบ employee มีอยู่จริง
        const employee = await prisma.employee.findUnique({
            where: { id: employeeId },
            select: { id: true },
        });

        if (!employee) {
            throw err.notFound({ employeeId });
        }

        // ตรวจสอบ positionId มีอยู่จริง
        await this._validatePositionExists(positionId);

        const wage = await prisma.wageRate.create({
            data: {
                employeeId,
                positionId,
                dailyRate,
                hourlyRate,
                minuteRate,
                monthlyRate,
                effectiveFrom: new Date(effectiveFrom),
                effectiveTo: effectiveTo ? new Date(effectiveTo) : null,
                note,
            },
            select: {
                ...prismaSelectDefault.wageRate,
                position: {
                    select: {
                        name: true,
                        employeeType: true,
                    }
                }
            },
        });

        return wage;
    }

    async updateWage(wageId, employeeId, { positionId, dailyRate, hourlyRate, minuteRate, monthlyRate, effectiveFrom, effectiveTo, note }) {
        // ตรวจสอบ wage มีอยู่จริงและเป็นของ employee คนนี้
        const wage = await prisma.wageRate.findUnique({
            where: { id: wageId },
            select: { id: true, employeeId: true },
        });

        if (!wage) {
            throw err.notFound({ wageId });
        }

        if (wage.employeeId !== employeeId) {
            throw err.notFound({ wageId: 'ไม่พบค่าแรงของพนักงานคนนี้' });
        }

        // ถ้ามี positionId ให้ตรวจสอบว่า position มีอยู่จริง
        if (positionId !== undefined) {
            await this._validatePositionExists(positionId);
        }

        // ตรวจสอบ effectiveTo > effectiveFrom
        const finalEffectiveFrom = effectiveFrom !== undefined ? new Date(effectiveFrom) : undefined;
        const finalEffectiveTo = effectiveTo !== undefined ? (effectiveTo ? new Date(effectiveTo) : null) : undefined;

        if (finalEffectiveTo && finalEffectiveFrom && finalEffectiveTo <= finalEffectiveFrom) {
            throw err.validation({ effectiveTo: 'วันที่สิ้นสุดต้องมากกว่าวันที่เริ่มต้น' });
        }

        const updated = await prisma.wageRate.update({
            where: { id: wageId },
            data: {
                ...(positionId !== undefined && { positionId }),
                ...(dailyRate !== undefined && { dailyRate }),
                ...(hourlyRate !== undefined && { hourlyRate }),
                ...(minuteRate !== undefined && { minuteRate }),
                ...(monthlyRate !== undefined && { monthlyRate }),
                ...(finalEffectiveFrom !== undefined && { effectiveFrom: finalEffectiveFrom }),
                ...(finalEffectiveTo !== undefined && { effectiveTo: finalEffectiveTo }),
                ...(note !== undefined && { note }),
            },
            select: {
                ...prismaSelectDefault.wageRate,
                position: {
                    select: {
                        name: true,
                        employeeType: true,
                    }
                }
            },
        });

        return updated;
    }
}

export default new EmployeeService();

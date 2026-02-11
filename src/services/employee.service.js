import prisma from "../databases/prisma.js";
import redis from "../databases/redis.js";
import err from "../utils/error.js";
import { hashPassword } from "../utils/password.js";
import prismaSelectDefault from "../utils/prismaSelectDefault.js";

class EmployeeService {
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

        if (query.isActive) {
            where.isActive = query.isActive;
        }

        const [ employees, total ] = await Promise.all([
            prisma.employee.findMany({
                where,
                select: prismaSelectDefault.employee,
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

    async createEmployee({ firstName, lastName, idCard, phone }) {
        const employee = await prisma.employee.create({
            data: {
                firstName,
                lastName,
                idCard,
                phone,
            },
            select: {
                ...prismaSelectDefault.employee,
                createdAt: true,
                updatedAt: true,
            },
        });
        return employee;
    }

    async getEmployeeById({ id }) {
        const employee = await prisma.employee.findUnique({
            where: { id },
            select: {
                ...prismaSelectDefault.employee,
                createdAt: true,
                updatedAt: true,
            },
        });

        if (!employee) {
            throw err.notFound({ id });
        }

        return employee;
    }

    async updateEmployee(id, { firstName, lastName, idCard, phone, isActive }) {
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
                ...(isActive !== undefined && { isActive }),
            },
            select: {
                ...prismaSelectDefault.employee,
                createdAt: true,
                updatedAt: true,
            },
        });

        return updated;
    }

    async getEmployeeUsers({ employeeId, page, limit, sort, sortBy, username, role, isActive }) {
        // ตรวจสอบว่า employee มีอยู่จริง
        const employee = await prisma.employee.findUnique({
            where: { id: employeeId },
            select: { id: true },
        });

        if (!employee) {
            throw err.notFound({ employeeId });
        }

        const where = {
            employeeId,
            isDeleted: false,
        };

        if (username) {
            where.username = { contains: username, mode: 'insensitive' };
        }

        if (role) {
            where.role = role;
        }

        if (isActive !== undefined) {
            where.isActive = isActive;
        }

        const [ users, total ] = await Promise.all([
            prisma.user.findMany({
                where,
                select: prismaSelectDefault.user,
                skip: (page - 1) * limit,
                take: limit,
                orderBy: {
                    [sortBy]: sort,
                },
            }),
            prisma.user.count({
                where,
            }),
        ]);

        return {
            data: users,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        };
    }

    async getEmployeeUserById({ employeeId, userId }) {
        const user = await prisma.user.findFirst({
            where: {
                id: userId,
                employeeId,
                isDeleted: false,
            },
            select: {
                ...prismaSelectDefault.user,
                createdAt: true,
                updatedAt: true,
            },
        });

        if (!user) {
            throw err.notFound({
                employeeId,
                userId,
            });
        }

        return user;
    }

    async createUser({ id, username, password }) {
        const employee = await prisma.employee.findUnique({
            where: { id: id },
        });

        if (!employee) {
            throw err.notFound({ id });
        }

        const user = await prisma.user.create({
            data: {
                employeeId: id,
                username,
                passwordHash: await hashPassword(password),
                role: 'ACCOUNTING',
            },
            select: {
                ...prismaSelectDefault.user,
                createdAt: true,
                updatedAt: true,
            },
        });

        return user;

    }

    async updateEmployeeUser({ employeeId, userId, username, password, role, isActive, isDeleted }) {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { employeeId: true, isDeleted: true },
        });

        if (!user || user.employeeId !== employeeId || user.isDeleted === true) {
            throw err.notFound({
                employeeId,
                userId,
            });
        }

        const updateData = {};
        if (username !== undefined) {
            // ตรวจสอบชื่อผู้ใช้งาน
            const existingUser = await prisma.user.findUnique({
                where: { username, isDeleted: false },
                select: { id: true },
            });

            if (existingUser) {
                throw err.conflict({ username }, "ชื่อผู้ใช้งานนี้ ถูกใช้งานแล้ว");
            }

            updateData.username = username;
        }
        if (password !== undefined) updateData.passwordHash = await hashPassword(password);
        if (role !== undefined) updateData.role = role;
        if (isActive !== undefined) updateData.isActive = isActive;
        if (isDeleted !== undefined) updateData.isDeleted = isDeleted;

        const updated = await prisma.$transaction(async (tx) => {
            // อัปเดต user
            const updated = await tx.user.update({
                where: { id: userId },
                data: updateData,
                select: {
                    ...prismaSelectDefault.user,
                    createdAt: true,
                    updatedAt: true,
                },
            });

            // ลบ session ทั้งหมดของ user (DB)
            await tx.session.deleteMany({
                where: { userId: userId },
            });

            return updated;
        });

        // ลบ session ทั้งหมดของ user จาก Redis (ทำหลัง transaction สำเร็จ)
        // Redis key pattern: auth:access:{userId}:{accessToken}
        const keys = await redis().keys(`auth:access:${userId}:*`);
        if (keys.length > 0) {
            await redis().del(...keys);
        }

        return updated;
    }
}

export default new EmployeeService();
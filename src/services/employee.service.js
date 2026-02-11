import prisma from "../databases/prisma.js";
import err from "../utils/error.js";
import { hashPassword } from "../utils/password.js";

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

        const [ employees, total ] = await Promise.all([
            prisma.employee.findMany({
                where,
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
        });
        return employee;
    }

    async getEmployeeById({ id }) {
        const employee = await prisma.employee.findUnique({
            where: { id },
            select: {
                id: true,
                firstName: true,
                lastName: true,
                idCard: true,
                phone: true,
                isActive: true,
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
                id: true,
                firstName: true,
                lastName: true,
                idCard: true,
                phone: true,
                isActive: true,
            },
        });

        return updated;
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
        });

        return user;

    }
}

export default new EmployeeService();
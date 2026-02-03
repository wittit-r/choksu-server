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

    async createUser({ employeeId, username, password }) {
        const employee = await prisma.employee.findUnique({
            where: { id: employeeId },
        });

        if (!employee) {
            throw err.notFound({ employeeId }, 'Employee not found');
        }

        const user = await prisma.user.create({
            data: {
                employeeId,
                username,
                passwordHash: await hashPassword(password),
                role: 'ACCOUNTING',
            },
        });

        return user;

    }
}

export default new EmployeeService();
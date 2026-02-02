import prisma from "../databases/prisma.js";

class EmployeeService {
    async getEmployees({ page, limit, sort, sortBy, ...query }) {
        const where = {
            name: {
                contains: query.search,
            },
        };

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

    async createEmployee(data) {
        const employee = await prisma.employee.create({
            data: {
                name: data.name,
            },
        });
        return employee;
    }
}

export default new EmployeeService();
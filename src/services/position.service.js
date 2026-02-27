import prisma from "../databases/prisma.js";
import prismaSelectDefault from "../utils/prismaSelectDefault.js";
import err from "../utils/error.js";

class PositionService {
    async getPositions({ page, limit, sort, sortBy, ...query }) {
        const where = {};

        if (query.search) {
            where.OR = [
                { name: { contains: query.search, mode: 'insensitive' } },
                { code: { contains: query.search, mode: 'insensitive' } },
            ];
        }

        if (query.isActive !== undefined) {
            where.isActive = query.isActive;
        }

        if (query.employeeType !== undefined) {
            where.employeeType = query.employeeType;
        }

        const [positions, total] = await Promise.all([
            prisma.position.findMany({
                where,
                select: prismaSelectDefault.position,
                skip: (page - 1) * limit,
                take: limit,
                orderBy: {
                    [sortBy]: sort,
                },
            }),
            prisma.position.count({
                where,
            }),
        ]);

        return {
            data: positions,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        };
    }

    async createPosition(data) {
        const position = await prisma.position.create({
            data: {
                name: data.name,
                code: data.code,
                employeeType: data.employeeType,
                isActive: data.isActive ?? true,
            },
            select: prismaSelectDefault.position,
        });

        return position;
    }

    async updatePosition(id, data) {
        const position = await prisma.position.findUnique({
            where: { id },
        });

        if (!position) {
            throw err.notFound({ id });
        }

        const updated = await prisma.position.update({
            where: { id },
            data: {
                name: data.name,
                code: data.code,
                employeeType: data.employeeType,
                isActive: data.isActive,
            },
            select: prismaSelectDefault.position,
        });

        return updated;
    }
}

export default new PositionService();

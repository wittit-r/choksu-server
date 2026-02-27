import prisma from "../databases/prisma.js";
import prismaSelectDefault from "../utils/prismaSelectDefault.js";
import err from "../utils/error.js";

class BranchService {
    async getBranches({ page, limit, sort, sortBy, ...query }) {
        const where = {};

        if (query.search) {
            where.OR = [
                { name: { contains: query.search, mode: 'insensitive' } },
            ];
        }

        const [branches, total] = await Promise.all([
            prisma.branch.findMany({
                where,
                select: prismaSelectDefault.branch,
                skip: (page - 1) * limit,
                take: limit,
                orderBy: {
                    [sortBy]: sort,
                },
            }),
            prisma.branch.count({
                where,
            }),
        ]);

        return {
            data: branches,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        };
    }

    async createBranch(data) {
        const branch = await prisma.branch.create({
            data: {
                name: data.name,
            },
            select: prismaSelectDefault.branch,
        });

        return branch;
    }

    async updateBranch(id, data) {
        const branch = await prisma.branch.findUnique({
            where: { id },
        });

        if (!branch) {
            throw err.notFound({ id });
        }

        const updated = await prisma.branch.update({
            where: { id },
            data: {
                name: data.name,
            },
            select: prismaSelectDefault.branch,
        });

        return updated;
    }
}

export default new BranchService();

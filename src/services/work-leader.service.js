import prisma from "../databases/prisma.js";
import prismaSelectDefault from "../utils/prismaSelectDefault.js";
import err from "../utils/error.js";

class WorkLeaderService {
    async _validateBranchExists(branchId) {
        const branch = await prisma.branch.findUnique({
            where: { id: branchId },
            select: { id: true },
        });

        if (!branch) {
            throw err.validation({ branchId: 'ไม่พบสาขาที่ระบุ' });
        }

        return branch;
    }

    async getWorkLeaders({ page, limit, sort, sortBy, ...query }) {
        const where = {};

        if (query.search) {
            where.OR = [
                { name: { contains: query.search, mode: 'insensitive' } },
                { refNo: { contains: query.search, mode: 'insensitive' } },
            ];
        }

        if (query.isActive !== undefined) {
            where.isActive = query.isActive;
        }

        if (query.branchId !== undefined) {
            where.branchId = query.branchId;
        }

        const [workLeaders, total] = await Promise.all([
            prisma.workLeader.findMany({
                where,
                select: prismaSelectDefault.workLeader,
                skip: (page - 1) * limit,
                take: limit,
                orderBy: {
                    [sortBy]: sort,
                },
            }),
            prisma.workLeader.count({
                where,
            }),
        ]);

        return {
            data: workLeaders,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        };
    }

    async createWorkLeader(data) {
        await this._validateBranchExists(data.branchId);

        const workLeader = await prisma.workLeader.create({
            data: {
                name: data.name,
                refNo: data.refNo,
                branchId: data.branchId,
                isActive: data.isActive ?? true,
            },
            select: prismaSelectDefault.workLeader,
        });

        return workLeader;
    }

    async updateWorkLeader(id, data) {
        const workLeader = await prisma.workLeader.findUnique({
            where: { id },
        });

        if (!workLeader) {
            throw err.notFound({ id });
        }

        if (data.branchId !== undefined) {
            await this._validateBranchExists(data.branchId);
        }

        const updated = await prisma.workLeader.update({
            where: { id },
            data: {
                name: data.name,
                refNo: data.refNo,
                branchId: data.branchId,
                isActive: data.isActive,
            },
            select: prismaSelectDefault.workLeader,
        });

        return updated;
    }
}

export default new WorkLeaderService();

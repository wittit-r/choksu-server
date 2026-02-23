import prisma from "../databases/prisma.js";
import redis from "../databases/redis.js";
import err from "../utils/error.js";
import { hashPassword } from "../utils/password.js";

class UserService {
    async getUsers({ page, limit, sort, sortBy, ...query }) {
        const where = { isDeleted: false };

        if (query.search) {
            where.OR = [
                { firstName: { contains: query.search, mode: 'insensitive' } },
                { lastName: { contains: query.search, mode: 'insensitive' } },
                { username: { contains: query.search, mode: 'insensitive' } },
            ];
        }

        if (query.role) {
            where.role = query.role;
        }

        if (query.isActive !== undefined) {
            where.isActive = query.isActive;
        }

        const [users, total] = await Promise.all([
            prisma.user.findMany({
                where,
                select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    username: true,
                    phone: true,
                    role: true,
                    branchId: true,
                    branch: { select: { id: true, name: true } },
                    isActive: true,
                    createdAt: true,
                },
                skip: (page - 1) * limit,
                take: limit,
                orderBy: { [sortBy]: sort },
            }),
            prisma.user.count({ where }),
        ]);

        return {
            data: users,
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        };
    }

    async getUserById({ id }) {
        const user = await prisma.user.findUnique({
            where: { id, isDeleted: false },
            select: {
                id: true,
                firstName: true,
                lastName: true,
                username: true,
                phone: true,
                role: true,
                branchId: true,
                branch: { select: { id: true, name: true } },
                isActive: true,
                createdAt: true,
                updatedAt: true,
            },
        });

        if (!user) throw err.notFound({ id });
        return user;
    }

    async createUser({ firstName, lastName, username, password, phone, role, branchId }) {
        // Check duplicate username
        const existing = await prisma.user.findUnique({
            where: { username },
            select: { id: true },
        });
        if (existing) throw err.conflict({ username }, "ชื่อผู้ใช้นี้ถูกใช้งานแล้ว");

        const user = await prisma.user.create({
            data: {
                firstName,
                lastName,
                username,
                passwordHash: await hashPassword(password),
                phone,
                role: role || 'ACCOUNTING',
                branchId,
            },
            select: {
                id: true,
                firstName: true,
                lastName: true,
                username: true,
                phone: true,
                role: true,
                branchId: true,
                isActive: true,
                createdAt: true,
            },
        });

        return user;
    }

    async updateUser({ id, ...updateData }) {
        const user = await prisma.user.findUnique({
            where: { id, isDeleted: false },
            select: { id: true },
        });
        if (!user) throw err.notFound({ id });

        const data = {};
        if (updateData.firstName !== undefined) data.firstName = updateData.firstName;
        if (updateData.lastName !== undefined) data.lastName = updateData.lastName;
        if (updateData.phone !== undefined) data.phone = updateData.phone;
        if (updateData.role !== undefined) data.role = updateData.role;
        if (updateData.branchId !== undefined) data.branchId = updateData.branchId;
        if (updateData.isActive !== undefined) data.isActive = updateData.isActive;
        if (updateData.isDeleted !== undefined) data.isDeleted = updateData.isDeleted;

        if (updateData.username !== undefined) {
            const existing = await prisma.user.findFirst({
                where: { username: updateData.username, NOT: { id } },
            });
            if (existing) throw err.conflict({ username: updateData.username }, "ชื่อผู้ใช้นี้ถูกใช้งานแล้ว");
            data.username = updateData.username;
        }

        if (updateData.password !== undefined) {
            data.passwordHash = await hashPassword(updateData.password);
        }

        const updated = await prisma.$transaction(async (tx) => {
            const updated = await tx.user.update({
                where: { id },
                data,
                select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    username: true,
                    phone: true,
                    role: true,
                    branchId: true,
                    isActive: true,
                    createdAt: true,
                    updatedAt: true,
                },
            });

            // Invalidate sessions if password changed or account deactivated
            if (updateData.password !== undefined || updateData.isDeleted === true) {
                await tx.session.deleteMany({ where: { userId: id } });
            }

            return updated;
        });

        // Clear Redis cache for this user
        if (updateData.password !== undefined || updateData.isDeleted === true || updateData.isActive === false) {
            const keys = await redis().keys(`auth:access:${id}:*`);
            if (keys.length > 0) await redis().del(...keys);
        }

        return updated;
    }
}

export default new UserService();

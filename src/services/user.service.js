import prisma from "../databases/prisma.js";
import redis from "../databases/redis.js";
import err from "../utils/error.js";
import { hashPassword } from "../utils/password.js";

/**
 * @typedef {Object} PaginationResult
 * @property {Array} data - ข้อมูลที่ดึงมา
 * @property {Object} pagination - ข้อมูล pagination
 * @property {number} pagination.page - หน้าปัจจุบัน
 * @property {number} pagination.limit - จำนวนรายการต่อหน้า
 * @property {number} pagination.total - จำนวนรายการทั้งหมด
 * @property {number} pagination.totalPages - จำนวนหน้าทั้งหมด
 */

/**
 * @typedef {Object} User
 * @property {string} id - User ID (UUID)
 * @property {string} firstName - ชื่อจริง
 * @property {string} lastName - นามสกุล
 * @property {string} username - ชื่อผู้ใช้
 * @property {string} [phone] - เบอร์โทรศัพท์
 * @property {string} role - บทบาท (ADMIN, ACCOUNTING, etc.)
 * @property {string} [branchId] - ID ของสาขา
 * @property {Object} [branch] - ข้อมูลสาขา
 * @property {boolean} isActive - สถานะการใช้งาน
 * @property {Date} createdAt - วันที่สร้าง
 * @property {Date} [updatedAt] - วันที่อัปเดต
 */

/**
 * Service สำหรับจัดการข้อมูลผู้ใช้งานระบบ
 */
class UserService {
    /**
     * ดึงรายการผู้ใช้งานทั้งหมดพร้อม pagination
     * @param {Object} params - Query parameters
     * @param {number} params.page - หน้าปัจจุบัน
     * @param {number} params.limit - จำนวนรายการต่อหน้า
     * @param {'asc'|'desc'} params.sort - ทิศทางการเรียงลำดับ
     * @param {string} params.sortBy - ฟิลด์ที่ใช้เรียงลำดับ
     * @param {string} [params.search] - คำค้นหา (ค้นหาใน firstName, lastName, username)
     * @param {string} [params.role] - กรองตามบทบาท
     * @param {boolean} [params.isActive] - กรองตามสถานะการใช้งาน
     * @returns {Promise<PaginationResult>} รายการผู้ใช้งานพร้อม pagination
     */
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

    /**
     * ดึงข้อมูลผู้ใช้งานตาม ID
     * @param {Object} params - Parameters
     * @param {string} params.id - User ID (UUID)
     * @returns {Promise<User>} ข้อมูลผู้ใช้งาน
     * @throws {AppError} ไม่พบผู้ใช้งาน (notFound)
     */
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

    /**
     * สร้างผู้ใช้งานใหม่
     * @param {Object} params - ข้อมูลผู้ใช้งานใหม่
     * @param {string} params.firstName - ชื่อจริง
     * @param {string} params.lastName - นามสกุล
     * @param {string} params.username - ชื่อผู้ใช้
     * @param {string} params.password - รหัสผ่าน
     * @param {string} [params.phone] - เบอร์โทรศัพท์
     * @param {string} [params.role] - บทบาท (default: 'ACCOUNTING')
     * @param {string} [params.branchId] - ID ของสาขา
     * @returns {Promise<User>} ข้อมูลผู้ใช้งานที่สร้างใหม่
     * @throws {AppError} ชื่อผู้ใช้ซ้ำ (conflict)
     */
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

    /**
     * อัปเดตข้อมูลผู้ใช้งาน
     * @param {Object} params - ข้อมูลที่จะอัปเดต
     * @param {string} params.id - User ID (UUID)
     * @param {string} [params.firstName] - ชื่อจริง
     * @param {string} [params.lastName] - นามสกุล
     * @param {string} [params.username] - ชื่อผู้ใช้
     * @param {string} [params.password] - รหัสผ่านใหม่
     * @param {string} [params.phone] - เบอร์โทรศัพท์
     * @param {string} [params.role] - บทบาท
     * @param {string} [params.branchId] - ID ของสาขา
     * @param {boolean} [params.isActive] - สถานะการใช้งาน
     * @param {boolean} [params.isDeleted] - สถานะการลบ
     * @returns {Promise<User>} ข้อมูลผู้ใช้งานที่อัปเดตแล้ว
     * @throws {AppError} ไม่พบผู้ใช้งาน (notFound) หรือ ชื่อผู้ใช้ซ้ำ (conflict)
     */
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

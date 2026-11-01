import { Op } from "sequelize";

import { User, Session, sequelize } from "../database/index.js";
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
            // collation ของ MySQL (utf8mb4_*_ai_ci) เทียบไม่สน case อยู่แล้ว
            where[Op.or] = [
                { firstName: { [Op.like]: `%${query.search}%` } },
                { lastName: { [Op.like]: `%${query.search}%` } },
                { username: { [Op.like]: `%${query.search}%` } },
            ];
        }

        if (query.role) {
            where.role = query.role;
        }

        if (query.isActive !== undefined) {
            where.isActive = query.isActive;
        }

        const { rows: users, count: total } = await User.findAndCountAll({
            where,
            attributes: ["id", "firstName", "lastName", "username", "phone", "role", "branchId", "isActive", "createdAt"],
            include: { association: "branch", attributes: ["id", "name"] },
            offset: (page - 1) * limit,
            limit,
            order: [[sortBy, sort]],
        });

        return {
            data: users,
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        };
    }

    /**
     * ดึงข้อมูลผู้ใช้งานตาม ID
     * @param {Object} params - Parameters
     * @param {number} params.id - User ID
     * @returns {Promise<User>} ข้อมูลผู้ใช้งาน
     * @throws {AppError} ไม่พบผู้ใช้งาน (notFound)
     */
    async getUserById({ id }) {
        const user = await User.findOne({
            where: { id, isDeleted: false },
            attributes: ["id", "firstName", "lastName", "username", "phone", "role", "branchId", "isActive", "createdAt", "updatedAt"],
            include: { association: "branch", attributes: ["id", "name"] },
        });

        if (!user) throw err.notFound({ id });
        return user;
    }

    /**
     * สร้างผู้ใช้งานใหม่
     * @param {Object} params - ข้อมูลผู้ใช้งานใหม่
     * @returns {Promise<User>} ข้อมูลผู้ใช้งานที่สร้างใหม่
     * @throws {AppError} ชื่อผู้ใช้ซ้ำ (conflict)
     */
    async createUser({ firstName, lastName, username, password, phone, role, branchId }) {
        // Check duplicate username
        const existing = await User.findOne({
            where: { username },
            attributes: ["id"],
        });
        if (existing) throw err.conflict({ username }, "ชื่อผู้ใช้นี้ถูกใช้งานแล้ว");

        return User.create({
            firstName,
            lastName,
            username,
            passwordHash: await hashPassword(password),
            phone,
            role: role || "ACCOUNTING",
            branchId,
        }, {
            attributes: { exclude: ["passwordHash"] },
            returning: true,
        });
    }

    /**
     * อัปเดตข้อมูลผู้ใช้งาน
     * @param {Object} params - ข้อมูลที่จะอัปเดต
     * @returns {Promise<User>} ข้อมูลผู้ใช้งานที่อัปเดตแล้ว
     * @throws {AppError} ไม่พบผู้ใช้งาน (notFound) หรือ ชื่อผู้ใช้ซ้ำ (conflict)
     */
    async updateUser({ id, ...updateData }) {
        const user = await User.findOne({
            where: { id, isDeleted: false },
            attributes: ["id"],
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
            const existing = await User.findOne({
                where: { username: updateData.username, id: { [Op.ne]: id } },
                attributes: ["id"],
            });
            if (existing) throw err.conflict({ username: updateData.username }, "ชื่อผู้ใช้นี้ถูกใช้งานแล้ว");
            data.username = updateData.username;
        }

        if (updateData.password !== undefined) {
            data.passwordHash = await hashPassword(updateData.password);
        }

        const updated = await sequelize.transaction(async (t) => {
            await User.update(data, { where: { id }, transaction: t });

            // Invalidate sessions if password changed or account deactivated
            if (updateData.password !== undefined || updateData.isDeleted === true) {
                await Session.destroy({ where: { userId: id }, transaction: t });
            }

            return User.findByPk(id, {
                attributes: ["id", "firstName", "lastName", "username", "phone", "role", "branchId", "isActive", "createdAt", "updatedAt"],
                transaction: t,
            });
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

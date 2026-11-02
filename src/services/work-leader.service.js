import { Op } from "sequelize";

import { Branch, WorkLeader } from "../database/index.js";
import err from "../utils/error.js";

/**
 * Service สำหรับจัดการข้อมูลหัวหน้างาน
 */
class WorkLeaderService {
    /**
     * ตรวจสอบว่าสาขามีอยู่จริง
     * @private
     * @param {number} branchId - Branch ID
     * @throws {AppError} ไม่พบสาขา (validation)
     */
    async _validateBranchExists(branchId) {
        const branch = await Branch.findByPk(branchId, {
            attributes: ["id"],
        });
        if (!branch) {
            throw err.validation({ branchId }, "ไม่พบสาขา");
        }
    }

    /**
     * ดึงรายการหัวหน้างานทั้งหมดพร้อม pagination
     * @param {Object} params - Query parameters
     * @param {number} params.page - หน้าปัจจุบัน
     * @param {number} params.limit - จำนวนรายการต่อหน้า
     * @param {'asc'|'desc'} params.sort - ทิศทางการเรียงลำดับ
     * @param {string} params.sortBy - ฟิลด์ที่ใช้เรียงลำดับ
     * @param {string} [params.search] - คำค้นหา (ค้นหาใน name, refNo)
     * @param {boolean} [params.isActive] - กรองตามสถานะการใช้งาน
     * @param {number} [params.branchId] - กรองตามสาขา
     * @returns {Promise<PaginationResult>} รายการหัวหน้างานพร้อม pagination
     */
    async getWorkLeaders({ page, limit, sort, sortBy, ...query }) {
        const where = {};

        if (query.search) {
            where[Op.or] = [
                { name: { [Op.like]: `%${query.search}%` } },
                { refNo: { [Op.like]: `%${query.search}%` } },
            ];
        }

        if (query.isActive !== undefined) {
            where.isActive = query.isActive;
        }

        if (query.branchId !== undefined) {
            where.branchId = query.branchId;
        }

        const { rows: workLeaders, count: total } = await WorkLeader.findAndCountAll({
            where,
            include: { association: "branch" },
            offset: (page - 1) * limit,
            limit,
            order: [[sortBy, sort]],
        });

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

    /**
     * ดึงข้อมูลหัวหน้างานตาม ID
     * @param {Object} params - Parameters
     * @param {number} params.id - WorkLeader ID
     * @returns {Promise<WorkLeader>} ข้อมูลหัวหน้างาน
     * @throws {AppError} ไม่พบหัวหน้างาน (notFound)
     */
    async getWorkLeaderById({ id }) {
        const workLeader = await WorkLeader.findByPk(id, {
            include: { association: "branch" },
        });

        if (!workLeader) {
            throw err.notFound({ id });
        }

        return workLeader;
    }

    /**
     * สร้างหัวหน้างานใหม่
     * @param {WorkLeaderData} data - ข้อมูลหัวหน้างานใหม่
     * @returns {Promise<WorkLeader>} ข้อมูลหัวหน้างานที่สร้างใหม่
     * @throws {AppError} ไม่พบสาขา (validation)
     */
    async createWorkLeader(data) {
        await this._validateBranchExists(data.branchId);

        return WorkLeader.create({
            name: data.name,
            refNo: data.refNo,
            branchId: data.branchId,
            isActive: data.isActive ?? true,
        }, { include: { association: "branch" } });
    }

    /**
     * อัปเดตข้อมูลหัวหน้างาน
     * @param {number} id - WorkLeader ID
     * @param {WorkLeaderData} data - ข้อมูลที่จะอัปเดต
     * @returns {Promise<WorkLeader>} ข้อมูลหัวหน้างานที่อัปเดตแล้ว
     * @throws {AppError} ไม่พบหัวหน้างาน (notFound) หรือ ไม่พบสาขา (validation)
     */
    async updateWorkLeader(id, data) {
        const workLeader = await WorkLeader.findByPk(id);

        if (!workLeader) {
            throw err.notFound({ id });
        }

        if (data.branchId !== undefined) {
            await this._validateBranchExists(data.branchId);
        }

        // อัปเดตเฉพาะฟิลด์ที่ส่งมา (กัน undefined → null → notNull violation)
        if (data.name !== undefined) workLeader.name = data.name;
        if (data.refNo !== undefined) workLeader.refNo = data.refNo;
        if (data.branchId !== undefined) workLeader.branchId = data.branchId;
        if (data.isActive !== undefined) workLeader.isActive = data.isActive;
        await workLeader.save();

        return WorkLeader.findByPk(id, {
            include: { association: "branch" },
        });
    }
}

export default new WorkLeaderService();

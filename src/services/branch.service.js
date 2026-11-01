import { Op } from "sequelize";

import { Branch } from "../database/index.js";
import err from "../utils/error.js";

/**
 * Service สำหรับจัดการข้อมูลสาขา
 */
class BranchService {
    /**
     * ดึงรายการสาขาทั้งหมดพร้อม pagination
     * @param {Object} params - Query parameters
     * @param {number} params.page - หน้าปัจจุบัน
     * @param {number} params.limit - จำนวนรายการต่อหน้า
     * @param {'asc'|'desc'} params.sort - ทิศทางการเรียงลำดับ
     * @param {string} params.sortBy - ฟิลด์ที่ใช้เรียงลำดับ
     * @param {string} [params.search] - คำค้นหา (ค้นหาใน name, fullname)
     * @returns {Promise<PaginationResult>} รายการสาขาพร้อม pagination
     */
    async getBranches({ page, limit, sort, sortBy, ...query }) {
        const where = {};

        if (query.search) {
            // collation MySQL เทียบไม่สน case อยู่แล้ว
            where[Op.or] = [
                { name: { [Op.like]: `%${query.search}%` } },
                { fullname: { [Op.like]: `%${query.search}%` } },
            ];
        }

        const { rows: branches, count: total } = await Branch.findAndCountAll({
            where,
            offset: (page - 1) * limit,
            limit,
            order: [[sortBy, sort]],
        });

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

    /**
     * ดึงข้อมูลสาขาตาม ID
     * @param {Object} params - Parameters
     * @param {number} params.id - Branch ID
     * @returns {Promise<Branch>} ข้อมูลสาขา
     * @throws {AppError} ไม่พบสาขา (notFound)
     */
    async getBranchById({ id }) {
        const branch = await Branch.findByPk(id);

        if (!branch) {
            throw err.notFound({ id });
        }

        return branch;
    }

    /**
     * สร้างสาขาใหม่
     * @param {BranchData} data - ข้อมูลสาขาใหม่
     * @returns {Promise<Branch>} ข้อมูลสาขาที่สร้างใหม่
     */
    async createBranch(data) {
        return Branch.create({
            name: data.name,
            fullname: data.fullname,
        });
    }

    /**
     * อัปเดตข้อมูลสาขา
     * @param {number} id - Branch ID
     * @param {BranchData} data - ข้อมูลที่จะอัปเดต
     * @returns {Promise<Branch>} ข้อมูลสาขาที่อัปเดตแล้ว
     * @throws {AppError} ไม่พบสาขา (notFound)
     */
    async updateBranch(id, data) {
        const branch = await Branch.findByPk(id);

        if (!branch) {
            throw err.notFound({ id });
        }

        branch.name = data.name;
        branch.fullname = data.fullname;
        await branch.save();

        return branch;
    }
}

export default new BranchService();

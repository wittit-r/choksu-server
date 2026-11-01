import { Op } from "sequelize";

import { Position } from "../database/index.js";
import err from "../utils/error.js";

/**
 * Service สำหรับจัดการข้อมูลตำแหน่งงาน
 */
class PositionService {
    /**
     * ดึงรายการตำแหน่งงานทั้งหมดพร้อม pagination
     * @param {Object} params - Query parameters
     * @param {number} params.page - หน้าปัจจุบัน
     * @param {number} params.limit - จำนวนรายการต่อหน้า
     * @param {'asc'|'desc'} params.sort - ทิศทางการเรียงลำดับ
     * @param {string} params.sortBy - ฟิลด์ที่ใช้เรียงลำดับ
     * @param {string} [params.search] - คำค้นหา (ค้นหาใน name, code)
     * @param {string} [params.employeeType] - กรองตามประเภทพนักงาน
     * @returns {Promise<PaginationResult>} รายการตำแหน่งงานพร้อม pagination
     */
    async getPositions({ page, limit, sort, sortBy, ...query }) {
        const where = {};

        if (query.search) {
            where[Op.or] = [
                { name: { [Op.like]: `%${query.search}%` } },
                { code: { [Op.like]: `%${query.search}%` } },
            ];
        }

        if (query.employeeType) {
            where.employeeType = query.employeeType;
        }

        const { rows: positions, count: total } = await Position.findAndCountAll({
            where,
            offset: (page - 1) * limit,
            limit,
            order: [[sortBy, sort]],
        });

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

    /**
     * ดึงข้อมูลตำแหน่งงานตาม ID
     * @param {Object} params - Parameters
     * @param {number} params.id - Position ID
     * @returns {Promise<Position>} ข้อมูลตำแหน่งงาน
     * @throws {AppError} ไม่พบตำแหน่งงาน (notFound)
     */
    async getPositionById({ id }) {
        const position = await Position.findByPk(id);

        if (!position) {
            throw err.notFound({ id });
        }

        return position;
    }

    /**
     * สร้างตำแหน่งงานใหม่
     * @param {PositionData} data - ข้อมูลตำแหน่งงานใหม่
     * @returns {Promise<Position>} ข้อมูลตำแหน่งงานที่สร้างใหม่
     */
    async createPosition(data) {
        return Position.create({
            name: data.name,
            code: data.code,
            employeeType: data.employeeType,
            isActive: data.isActive ?? true,
        });
    }

    /**
     * อัปเดตข้อมูลตำแหน่งงาน
     * @param {number} id - Position ID
     * @param {PositionData} data - ข้อมูลที่จะอัปเดต
     * @returns {Promise<Position>} ข้อมูลตำแหน่งงานที่อัปเดตแล้ว
     * @throws {AppError} ไม่พบตำแหน่งงาน (notFound)
     */
    async updatePosition(id, data) {
        const position = await Position.findByPk(id);

        if (!position) {
            throw err.notFound({ id });
        }

        position.name = data.name;
        position.code = data.code;
        position.employeeType = data.employeeType;
        position.isActive = data.isActive;
        await position.save();

        return position;
    }
}

export default new PositionService();

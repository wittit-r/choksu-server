import prisma from "../databases/prisma.js";
import prismaSelectDefault from "../utils/prismaSelectDefault.js";
import err from "../utils/error.js";

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
 * @typedef {Object} Position
 * @property {string} id - Position ID (UUID)
 * @property {string} name - ชื่อตำแหน่งงาน
 * @property {string} code - รหัสตำแหน่งงาน
 * @property {string} employeeType - ประเภทพนักงาน (GENERAL, DRIVER, AGENT, ACCOUNTANT)
 * @property {boolean} isActive - สถานะการใช้งาน
 * @property {Date} createdAt - วันที่สร้าง
 * @property {Date} updatedAt - วันที่อัปเดต
 */

/**
 * @typedef {Object} PositionData
 * @property {string} name - ชื่อตำแหน่งงาน
 * @property {string} code - รหัสตำแหน่งงาน
 * @property {string} employeeType - ประเภทพนักงาน
 * @property {boolean} [isActive=true] - สถานะการใช้งาน
 */

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
     * @param {boolean} [params.isActive] - กรองตามสถานะการใช้งาน
     * @param {string} [params.employeeType] - กรองตามประเภทพนักงาน
     * @returns {Promise<PaginationResult>} รายการตำแหน่งงานพร้อม pagination
     */
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

    /**
     * ดึงข้อมูลตำแหน่งงานตาม ID
     * @param {Object} params - Parameters
     * @param {number} params.id - Position ID
     * @returns {Promise<Position>} ข้อมูลตำแหน่งงาน
     * @throws {AppError} ไม่พบตำแหน่งงาน (notFound)
     */
    async getPositionById({ id }) {
        const position = await prisma.position.findUnique({
            where: { id },
            select: prismaSelectDefault.position,
        });

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

    /**
     * อัปเดตข้อมูลตำแหน่งงาน
     * @param {string} id - Position ID (UUID)
     * @param {PositionData} data - ข้อมูลที่จะอัปเดต
     * @returns {Promise<Position>} ข้อมูลตำแหน่งงานที่อัปเดตแล้ว
     * @throws {AppError} ไม่พบตำแหน่งงาน (notFound)
     */
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

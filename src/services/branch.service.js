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
 * @typedef {Object} Branch
 * @property {string} id - Branch ID (UUID)
 * @property {string} name - ชื่อสาขา (ย่อ)
 * @property {string} fullname - ชื่อสาขาเต็ม
 * @property {Date} createdAt - วันที่สร้าง
 * @property {Date} updatedAt - วันที่อัปเดต
 */

/**
 * @typedef {Object} BranchData
 * @property {string} name - ชื่อสาขา (ย่อ)
 * @property {string} fullname - ชื่อสาขาเต็ม
 */

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
            where.OR = [
                { name: { contains: query.search, mode: 'insensitive' } },
                { fullname: { contains: query.search, mode: 'insensitive' } },
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

    /**
     * สร้างสาขาใหม่
     * @param {BranchData} data - ข้อมูลสาขาใหม่
     * @returns {Promise<Branch>} ข้อมูลสาขาที่สร้างใหม่
     */
    async createBranch(data) {
        const branch = await prisma.branch.create({
            data: {
                name: data.name,
                fullname: data.fullname,
            },
            select: prismaSelectDefault.branch,
        });

        return branch;
    }

    /**
     * อัปเดตข้อมูลสาขา
     * @param {string} id - Branch ID (UUID)
     * @param {BranchData} data - ข้อมูลที่จะอัปเดต
     * @returns {Promise<Branch>} ข้อมูลสาขาที่อัปเดตแล้ว
     * @throws {AppError} ไม่พบสาขา (notFound)
     */
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
                fullname: data.fullname,
            },
            select: prismaSelectDefault.branch,
        });

        return updated;
    }
}

export default new BranchService();

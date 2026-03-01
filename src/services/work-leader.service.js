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
 * @typedef {Object} WorkLeader
 * @property {string} id - WorkLeader ID (UUID)
 * @property {string} name - ชื่อหัวหน้างาน
 * @property {string} refNo - รหัสอ้างอิง
 * @property {string} branchId - ID ของสาขา
 * @property {Object} branch - ข้อมูลสาขา
 * @property {boolean} isActive - สถานะการใช้งาน
 * @property {Date} createdAt - วันที่สร้าง
 * @property {Date} updatedAt - วันที่อัปเดต
 */

/**
 * @typedef {Object} WorkLeaderData
 * @property {string} name - ชื่อหัวหน้างาน
 * @property {string} refNo - รหัสอ้างอิง
 * @property {string} branchId - ID ของสาขา
 * @property {boolean} [isActive=true] - สถานะการใช้งาน
 */

/**
 * Service สำหรับจัดการข้อมูลหัวหน้างาน
 */
class WorkLeaderService {
    /**
     * ตรวจสอบว่าสาขามีอยู่จริง
     * @private
     * @param {string} branchId - Branch ID (UUID)
     * @returns {Promise<Object>} ข้อมูลสาขา
     * @throws {AppError} ไม่พบสาขา (validation)
     */
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

    /**
     * ดึงรายการหัวหน้างานทั้งหมดพร้อม pagination
     * @param {Object} params - Query parameters
     * @param {number} params.page - หน้าปัจจุบัน
     * @param {number} params.limit - จำนวนรายการต่อหน้า
     * @param {'asc'|'desc'} params.sort - ทิศทางการเรียงลำดับ
     * @param {string} params.sortBy - ฟิลด์ที่ใช้เรียงลำดับ
     * @param {string} [params.search] - คำค้นหา (ค้นหาใน name, refNo)
     * @param {boolean} [params.isActive] - กรองตามสถานะการใช้งาน
     * @param {string} [params.branchId] - กรองตามสาขา
     * @returns {Promise<PaginationResult>} รายการหัวหน้างานพร้อม pagination
     */
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
                select: {
                    ...prismaSelectDefault.workLeader,
                    branch: {
                        select: prismaSelectDefault.branch,
                    }
                },
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

    /**
     * ดึงข้อมูลหัวหน้างานตาม ID
     * @param {Object} params - Parameters
     * @param {number} params.id - WorkLeader ID
     * @returns {Promise<WorkLeader>} ข้อมูลหัวหน้างาน
     * @throws {AppError} ไม่พบหัวหน้างาน (notFound)
     */
    async getWorkLeaderById({ id }) {
        const workLeader = await prisma.workLeader.findUnique({
            where: { id },
            select: {
                ...prismaSelectDefault.workLeader,
                branch: {
                    select: prismaSelectDefault.branch,
                }
            },
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

        const workLeader = await prisma.workLeader.create({
            data: {
                name: data.name,
                refNo: data.refNo,
                branchId: data.branchId,
                isActive: data.isActive ?? true,
            },
            select: {
                ...prismaSelectDefault.workLeader,
                branch: {
                    select: prismaSelectDefault.branch,
                }
            },
        });

        return workLeader;
    }

    /**
     * อัปเดตข้อมูลหัวหน้างาน
     * @param {string} id - WorkLeader ID (UUID)
     * @param {WorkLeaderData} data - ข้อมูลที่จะอัปเดต
     * @returns {Promise<WorkLeader>} ข้อมูลหัวหน้างานที่อัปเดตแล้ว
     * @throws {AppError} ไม่พบหัวหน้างาน (notFound) หรือ ไม่พบสาขา (validation)
     */
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
            select: {
                ...prismaSelectDefault.workLeader,
                branch: {
                    select: prismaSelectDefault.branch,
                }
            },
        });

        return updated;
    }
}

export default new WorkLeaderService();

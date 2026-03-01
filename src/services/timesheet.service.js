import prisma from "../databases/prisma.js";
import err from "../utils/error.js";
import prismaSelectDefault from "../utils/prismaSelectDefault.js";

/**
 * @typedef {Object} TimeSheet
 * @property {number} id - TimeSheet ID
 * @property {string} sheetType - ประเภท (DAILY, MONTHLY)
 * @property {Date|null} workDate - วันทำงาน (DAILY)
 * @property {string|null} monthPeriod - เดือน (MONTHLY) "YYYY-MM"
 * @property {string} status - สถานะ (PENDING, FILLED, LOCKED)
 * @property {Array|null} files - ไฟล์แนบ (JSON array ของ S3 paths)
 * @property {Object|null} workLeader - ข้อมูลหัวหน้างาน (DAILY)
 * @property {Object|null} employee - ข้อมูลพนักงาน (MONTHLY)
 */

/**
 * Service สำหรับจัดการใบเซ็นชื่อ
 */
class TimeSheetService {
    /**
     * ดึงรายการ TimeSheet ทั้งหมดพร้อม pagination
     * @param {Object} params - Query parameters
     * @param {number} params.page - หน้าปัจจุบัน
     * @param {number} params.limit - จำนวนรายการต่อหน้า
     * @param {'asc'|'desc'} params.sort - ทิศทางการเรียงลำดับ
     * @param {string} params.sortBy - ฟิลด์ที่ใช้เรียงลำดับ
     * @param {string} [params.sheetType] - กรองตามประเภท (DAILY, MONTHLY)
     * @param {string} [params.status] - กรองตามสถานะ
     * @param {number} [params.workLeaderId] - กรองตามหัวหน้างาน (DAILY)
     * @param {number} [params.employeeId] - กรองตามพนักงาน (MONTHLY)
     * @param {string} [params.monthPeriod] - กรองตามเดือน "YYYY-MM" (MONTHLY)
     * @returns {Promise<Object>} รายการ TimeSheet พร้อม pagination
     */
    async getTimeSheets({ page, limit, sort, sortBy, ...query }) {
        const where = {};

        if (query.sheetType) {
            where.sheetType = query.sheetType;
        }

        if (query.status) {
            where.status = query.status;
        }

        if (query.workLeaderId !== undefined) {
            where.workLeaderId = query.workLeaderId;
        }

        if (query.employeeId !== undefined) {
            where.employeeId = query.employeeId;
        }

        if (query.monthPeriod) {
            where.monthPeriod = query.monthPeriod;
        }

        const [timeSheets, total] = await Promise.all([
            prisma.timeSheet.findMany({
                where,
                select: {
                    ...prismaSelectDefault.timeSheet,
                    createdAt: true,
                    workLeader: {
                        select: {
                            id: true,
                            name: true,
                            branch: {
                                select: prismaSelectDefault.branch,
                            },
                        },
                    },
                    employee: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                        },
                    },
                    _count: {
                        select: { timeEntries: true },
                    },
                },
                skip: (page - 1) * limit,
                take: limit,
                orderBy: {
                    [sortBy]: sort,
                },
            }),
            prisma.timeSheet.count({ where }),
        ]);

        // Transform data
        const data = timeSheets.map((ts) => ({
            ...ts,
            entryCount: ts._count.timeEntries,
            _count: undefined,
        }));

        return {
            data,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        };
    }

    /**
     * ดึงข้อมูล TimeSheet ตาม ID
     * @param {Object} params - Parameters
     * @param {number} params.id - TimeSheet ID
     * @returns {Promise<TimeSheet>} ข้อมูล TimeSheet
     * @throws {AppError} ไม่พบ TimeSheet (notFound)
     */
    async getTimeSheetById({ id }) {
        const timeSheet = await prisma.timeSheet.findUnique({
            where: { id },
            select: {
                ...prismaSelectDefault.timeSheet,
                createdAt: true,
                updatedAt: true,
                workLeader: {
                    select: {
                        id: true,
                        name: true,
                        branch: {
                            select: prismaSelectDefault.branch,
                        },
                    },
                },
                employee: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                    },
                },
                timeEntries: {
                    select: {
                        id: true,
                        employeeId: true,
                        startTime: true,
                        endTime: true,
                        shiftType: true,
                        workType: true,
                        otRate: true,
                        accommodation: true,
                        isNegative: true,
                        lockFlag: true,
                        note: true,
                        employee: {
                            select: {
                                id: true,
                                firstName: true,
                                lastName: true,
                            },
                        },
                    },
                },
            },
        });

        if (!timeSheet) {
            throw err.notFound({ id });
        }

        return timeSheet;
    }

    /**
     * สร้าง TimeSheet ใหม่ (DAILY หรือ MONTHLY)
     * @param {Object} params - ข้อมูล TimeSheet ใหม่
     * @param {string} params.sheetType - ประเภท (DAILY, MONTHLY)
     * @param {number} [params.workLeaderId] - ID หัวหน้างาน (DAILY)
     * @param {string} [params.workDate] - วันทำงาน ISO string (DAILY)
     * @param {number} [params.employeeId] - ID พนักงาน (MONTHLY)
     * @param {string} [params.monthPeriod] - เดือน "YYYY-MM" (MONTHLY)
     * @param {number} params.createBy - User ID ที่สร้าง
     * @returns {Promise<TimeSheet>} ข้อมูล TimeSheet ที่สร้างใหม่
     */
    async createTimeSheet({ sheetType, workLeaderId, workDate, employeeId, monthPeriod, createBy }) {
        // Validate based on sheetType
        if (sheetType === 'DAILY') {
            if (!workLeaderId || !workDate) {
                throw err.validation({
                    message: 'DAILY timesheet requires workLeaderId and workDate',
                });
            }
        } else if (sheetType === 'MONTHLY') {
            if (!employeeId || !monthPeriod) {
                throw err.validation({
                    message: 'MONTHLY timesheet requires employeeId and monthPeriod',
                });
            }
            // Validate monthPeriod format
            if (!/^\d{4}-\d{2}$/.test(monthPeriod)) {
                throw err.validation({
                    monthPeriod: 'รูปแบบเดือนต้องเป็น YYYY-MM',
                });
            }
        }

        const data = {
            sheetType,
            createBy,
            ...(sheetType === 'DAILY' && {
                workLeaderId,
                workDate: new Date(workDate),
            }),
            ...(sheetType === 'MONTHLY' && {
                employeeId,
                monthPeriod,
            }),
        };

        const timeSheet = await prisma.timeSheet.create({
            data,
            select: {
                ...prismaSelectDefault.timeSheet,
                createdAt: true,
                workLeader: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
                employee: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                    },
                },
            },
        });

        return timeSheet;
    }

    /**
     * อัปเดตข้อมูล TimeSheet
     * @param {number} id - TimeSheet ID
     * @param {Object} params - ข้อมูลที่จะอัปเดต
     * @returns {Promise<TimeSheet>} ข้อมูล TimeSheet ที่อัปเดตแล้ว
     * @throws {AppError} ไม่พบ TimeSheet (notFound)
     */
    async updateTimeSheet(id, { status, files, note }) {
        // ตรวจสอบว่ามี timeSheet อยู่จริง
        const timeSheet = await prisma.timeSheet.findUnique({
            where: { id },
            select: { id: true, status: true },
        });

        if (!timeSheet) {
            throw err.notFound({ id });
        }

        // ถ้า LOCKED แล้วไม่อนุญาตให้แก้ไข
        if (timeSheet.status === 'LOCKED') {
            throw err.validation({
                message: 'TimeSheet ถูกล็อคแล้ว ไม่สามารถแก้ไขได้',
            });
        }

        const updated = await prisma.timeSheet.update({
            where: { id },
            data: {
                ...(status !== undefined && { status }),
                ...(files !== undefined && { files }),
            },
            select: {
                ...prismaSelectDefault.timeSheet,
                createdAt: true,
                updatedAt: true,
                workLeader: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
                employee: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                    },
                },
            },
        });

        return updated;
    }

    /**
     * เพิ่มไฟล์แนบใน TimeSheet
     * @param {number} id - TimeSheet ID
     * @param {string} filePath - S3 path ของไฟล์
     * @returns {Promise<TimeSheet>} ข้อมูล TimeSheet ที่อัปเดตแล้ว
     */
    async addFile(id, filePath) {
        const timeSheet = await prisma.timeSheet.findUnique({
            where: { id },
            select: { id: true, files: true },
        });

        if (!timeSheet) {
            throw err.notFound({ id });
        }

        const currentFiles = timeSheet.files || [];
        const updatedFiles = [...currentFiles, filePath];

        return this.updateTimeSheet(id, { files: updatedFiles });
    }

    /**
     * ลบไฟล์แนบจาก TimeSheet
     * @param {number} id - TimeSheet ID
     * @param {string} filePath - S3 path ของไฟล์ที่จะลบ
     * @returns {Promise<TimeSheet>} ข้อมูล TimeSheet ที่อัปเดตแล้ว
     */
    async removeFile(id, filePath) {
        const timeSheet = await prisma.timeSheet.findUnique({
            where: { id },
            select: { id: true, files: true },
        });

        if (!timeSheet) {
            throw err.notFound({ id });
        }

        const currentFiles = timeSheet.files || [];
        const updatedFiles = currentFiles.filter((f) => f !== filePath);

        return this.updateTimeSheet(id, { files: updatedFiles });
    }

    /**
     * ล็อค TimeSheet (เปลี่ยนสถานะเป็น LOCKED)
     * @param {number} id - TimeSheet ID
     * @returns {Promise<TimeSheet>} ข้อมูล TimeSheet ที่อัปเดตแล้ว
     */
    async lockTimeSheet(id) {
        return this.updateTimeSheet(id, { status: 'LOCKED' });
    }

    /**
     * ปลดล็อค TimeSheet (เปลี่ยนสถานะเป็น FILLED)
     * @param {number} id - TimeSheet ID
     * @returns {Promise<TimeSheet>} ข้อมูล TimeSheet ที่อัปเดตแล้ว
     */
    async unlockTimeSheet(id) {
        const timeSheet = await prisma.timeSheet.findUnique({
            where: { id },
            select: { id: true },
        });

        if (!timeSheet) {
            throw err.notFound({ id });
        }

        // ปลดล็อคโดยตรง (ข้าม validation ใน updateTimeSheet)
        const updated = await prisma.timeSheet.update({
            where: { id },
            data: { status: 'FILLED' },
            select: {
                ...prismaSelectDefault.timeSheet,
                createdAt: true,
                updatedAt: true,
            },
        });

        return updated;
    }
}

export default new TimeSheetService();

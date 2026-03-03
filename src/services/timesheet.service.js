import prisma from "../databases/prisma.js";
import err from "../utils/error.js";
import { combineDateAndTime } from "../utils/date.js";
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
     * สร้าง TimeSheet พร้อม TimeEntries ใน transaction เดียว
     * @param {Object} params - ข้อมูล TimeSheet และ Entries
     * @param {number} params.workLeaderId - ID หัวหน้างาน
     * @param {string} params.workDate - วันทำงาน (ISO string)
     * @param {boolean} params.allowDuplicate - อนุญาตให้สร้างซ้ำได้
     * @param {Object} params.pattern - รูปแบบการทำงาน
     * @param {boolean} params.pattern.regular - true = REGULAR, false = OVERTIME
     * @param {number} params.pattern.ot - OT rate (0, 1, 1.5, 2, 3)
     * @param {Array} params.entries - รายการเวลาทำงาน
     * @param {number} params.createBy - User ID ที่สร้าง
     * @returns {Promise<Object>} ข้อมูล TimeSheet พร้อม TimeEntries
     */
    async createTimeSheetWithEntries({ workLeaderId, workDate, allowDuplicate, pattern, entries, createBy }) {
        // 1. Validate workLeader exists
        const workLeader = await prisma.workLeader.findUnique({
            where: { id: workLeaderId },
            select: { id: true },
        });
        if (!workLeader) {
            throw err.notFound({ workLeaderId }, 'ไม่พบหัวหน้างาน');
        }

        // 2. Validate all employees exist
        const employeeIds = [...new Set(entries.map((e) => e.employeeId))];
        const employees = await prisma.employee.findMany({
            where: { id: { in: employeeIds } },
            select: { id: true },
        });

        if (employees.length !== employeeIds.length) {
            const foundIds = employees.map((e) => e.id);
            const missingIds = employeeIds.filter((id) => !foundIds.includes(id));
            throw err.notFound({ missingEmployeeIds: missingIds }, 'ไม่พบพนักงานบางคน');
        }

        // 3. Build DateTime objects
        const workDateObj = combineDateAndTime(workDate, "00:00");
        const entriesWithDateTime = entries.map((entry) => ({
            ...entry,
            startTime: combineDateAndTime(workDate, entry.timeIn),
            endTime: combineDateAndTime(workDate, entry.timeOut),
        }));

        // 4. Map pattern to workType
        const workType = pattern.regular ? 'REGULAR' : 'OVERTIME';
        const otRate = pattern.ot || 0;

        // 5. Execute in transaction
        const result = await prisma.$transaction(async (tx) => {
            // Check for duplicate if allowDuplicate is false
            if (!allowDuplicate) {
                const existingSheet = await tx.timeSheet.findFirst({
                    where: {
                        workLeaderId,
                        workDate: workDateObj,
                    },
                    select: { id: true },
                });
                if (existingSheet) {
                    throw err.conflict(
                        { workLeaderId, workDate },
                        'มีการลงเวลาสำหรับหัวหน้างานและวันที่นี้แล้ว หากต้องการสร้างซ้ำ กรุณายืนยันการสร้าง'
                    );
                }
            }

            // Check for time overlaps for each employee
            await this.validateNoOverlaps(entriesWithDateTime, [], tx);

            // Create TimeSheet
            const timeSheet = await tx.timeSheet.create({
                data: {
                    workLeaderId,
                    workDate: workDateObj,
                    sheetType: 'DAILY',
                    status: 'PENDING',
                    createBy,
                },
                select: {
                    id: true,
                    sheetType: true,
                    workDate: true,
                    status: true,
                    createdAt: true,
                },
            });

            // Create all TimeEntries
            const timeEntries = await Promise.all(
                entriesWithDateTime.map((entry) =>
                    tx.timeEntry.create({
                        data: {
                            timeSheetId: timeSheet.id,
                            employeeId: entry.employeeId,
                            startTime: entry.startTime,
                            endTime: entry.endTime,
                            shiftType: entry.shiftType === 'regular' ? 'REGULAR' : 'SHIFT',
                            workType,
                            otRate,
                            accommodation: 0,
                            isNegative: false,
                            lockFlag: false,
                        },
                        select: {
                            id: true,
                            employeeId: true,
                            startTime: true,
                            endTime: true,
                            shiftType: true,
                            workType: true,
                            otRate: true,
                            employee: {
                                select: {
                                    id: true,
                                    firstName: true,
                                    lastName: true,
                                },
                            },
                        },
                    })
                )
            );

            return {
                ...timeSheet,
                timeEntries,
            };
        });

        return result;
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
     * อัปเดต TimeSheet พร้อม TimeEntries (เพิ่ม/แก้ไข/ลบ)
     * @param {number} id - TimeSheet ID
     * @param {Object} params - ข้อมูลที่จะอัปเดต
     * @param {string} [params.status] - สถานะใหม่
     * @param {Object} [params.entries] - การเปลี่ยนแปลง entries
     * @param {Array} [params.entries.add] - entries ที่จะเพิ่ม
     * @param {Array} [params.entries.update] - entries ที่จะแก้ไข
     * @param {Array} [params.entries.delete] - IDs ของ entries ที่จะลบ
     * @returns {Promise<Object>} ข้อมูล TimeSheet ที่อัปเดตแล้ว
     */
    async updateTimeSheetWithEntries(id, { status, entries }) {
        // 1. ตรวจสอบว่ามี timeSheet อยู่จริง
        const timeSheet = await prisma.timeSheet.findUnique({
            where: { id },
            select: {
                id: true,
                status: true,
                workDate: true,
                timeEntries: {
                    select: { id: true, employeeId: true, startTime: true, endTime: true },
                },
            },
        });

        if (!timeSheet) {
            throw err.notFound({ id });
        }

        // 2. ถ้า LOCKED แล้วไม่อนุญาตให้แก้ไข
        if (timeSheet.status === 'LOCKED') {
            throw err.validation({
                message: 'TimeSheet ถูกล็อคแล้ว ไม่สามารถแก้ไขได้',
            });
        }

        const workDateObj = timeSheet.workDate;
        const addEntries = entries?.add || [];
        const updateEntries = entries?.update || [];
        const deleteEntryIds = entries?.delete || [];

        // 3. Validate employees in add entries
        if (addEntries.length > 0) {
            const employeeIds = [...new Set(addEntries.map((e) => e.employeeId))];
            const employees = await prisma.employee.findMany({
                where: { id: { in: employeeIds } },
                select: { id: true },
            });

            if (employees.length !== employeeIds.length) {
                const foundIds = employees.map((e) => e.id);
                const missingIds = employeeIds.filter((id) => !foundIds.includes(id));
                throw err.notFound({ missingEmployeeIds: missingIds }, 'ไม่พบพนักงานบางคน');
            }
        }

        // 4. Validate update entries exist and belong to this timesheet
        if (updateEntries.length > 0) {
            const updateIds = updateEntries.map((e) => e.id);
            const existingEntries = await prisma.timeEntry.findMany({
                where: { id: { in: updateIds }, timeSheetId: id },
                select: { id: true },
            });

            if (existingEntries.length !== updateIds.length) {
                const foundIds = existingEntries.map((e) => e.id);
                const missingIds = updateIds.filter((id) => !foundIds.includes(id));
                throw err.notFound({ missingEntryIds: missingIds }, 'ไม่พบรายการเวลาบางรายการ');
            }
        }

        // 5. Validate delete entries exist and belong to this timesheet
        if (deleteEntryIds.length > 0) {
            const existingEntries = await prisma.timeEntry.findMany({
                where: { id: { in: deleteEntryIds }, timeSheetId: id },
                select: { id: true },
            });

            if (existingEntries.length !== deleteEntryIds.length) {
                const foundIds = existingEntries.map((e) => e.id);
                const missingIds = deleteEntryIds.filter((id) => !foundIds.includes(id));
                throw err.notFound({ missingEntryIds: missingIds }, 'ไม่พบรายการเวลาที่จะลบ');
            }
        }

        // 6. Build entries with DateTime for overlap validation
        const entriesToValidate = [];

        // Add entries
        for (const entry of addEntries) {
            entriesToValidate.push({
                ...entry,
                startTime: combineDateAndTime(workDateObj, entry.timeIn),
                endTime: combineDateAndTime(workDateObj, entry.timeOut),
            });
        }

        // Update entries - merge with existing data
        for (const entry of updateEntries) {
            const existing = timeSheet.timeEntries.find((e) => e.id === entry.id);
            const timeIn = entry.timeIn
                ? combineDateAndTime(workDateObj, entry.timeIn)
                : existing.startTime;
            const timeOut = entry.timeOut
                ? combineDateAndTime(workDateObj, entry.timeOut)
                : existing.endTime;

            entriesToValidate.push({
                ...entry,
                employeeId: existing.employeeId,
                startTime: timeIn,
                endTime: timeOut,
                timeIn: entry.timeIn || existing.startTime.toTimeString().slice(0, 5),
                timeOut: entry.timeOut || existing.endTime.toTimeString().slice(0, 5),
            });
        }

        // 7. Check for overlaps (excluding entries being updated/deleted)
        const excludeIds = [...updateEntries.map((e) => e.id), ...deleteEntryIds];
        if (entriesToValidate.length > 0) {
            await this.validateNoOverlaps(entriesToValidate, excludeIds);
        }

        // 8. Execute in transaction
        const result = await prisma.$transaction(async (tx) => {
            // Delete entries
            if (deleteEntryIds.length > 0) {
                await tx.timeEntry.deleteMany({
                    where: { id: { in: deleteEntryIds } },
                });
            }

            // Update entries
            for (const entry of updateEntries) {
                const updateData = {};
                if (entry.timeIn) {
                    updateData.startTime = combineDateAndTime(workDateObj, entry.timeIn);
                }
                if (entry.timeOut) {
                    updateData.endTime = combineDateAndTime(workDateObj, entry.timeOut);
                }
                if (entry.shiftType) {
                    updateData.shiftType = entry.shiftType === 'regular' ? 'REGULAR' : 'SHIFT';
                }

                if (Object.keys(updateData).length > 0) {
                    await tx.timeEntry.update({
                        where: { id: entry.id },
                        data: updateData,
                    });
                }
            }

            // Add entries - get workType and otRate from existing entries pattern
            // For simplicity, use REGULAR workType and 0 otRate for new entries
            // This can be enhanced later if needed
            const newEntries = [];
            for (const entry of addEntries) {
                const newEntry = await tx.timeEntry.create({
                    data: {
                        timeSheetId: id,
                        employeeId: entry.employeeId,
                        startTime: combineDateAndTime(workDateObj, entry.timeIn),
                        endTime: combineDateAndTime(workDateObj, entry.timeOut),
                        shiftType: entry.shiftType === 'regular' ? 'REGULAR' : 'SHIFT',
                        workType: 'REGULAR',
                        otRate: 0,
                        accommodation: 0,
                        isNegative: false,
                        lockFlag: false,
                    },
                    select: {
                        id: true,
                        employeeId: true,
                        startTime: true,
                        endTime: true,
                        shiftType: true,
                        workType: true,
                        otRate: true,
                        employee: {
                            select: {
                                id: true,
                                firstName: true,
                                lastName: true,
                            },
                        },
                    },
                });
                newEntries.push(newEntry);
            }

            // Update timesheet status
            const updatedTimeSheet = await tx.timeSheet.update({
                where: { id },
                data: {
                    ...(status !== undefined && { status }),
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
                    timeEntries: {
                        select: {
                            id: true,
                            employeeId: true,
                            startTime: true,
                            endTime: true,
                            shiftType: true,
                            workType: true,
                            otRate: true,
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

            return updatedTimeSheet;
        });

        return result;
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

    // ============================================
    // Helper Methods
    // ============================================

    /**
     * ตรวจสอบว่าช่วงเวลาสองช่วงทับซ้อนกันหรือไม่
     * Overlap: start1 < end2 AND end1 > start2
     * @param {Date} start1 - เวลาเริ่มต้นช่วงที่ 1
     * @param {Date} end1 - เวลาสิ้นสุดช่วงที่ 1
     * @param {Date} start2 - เวลาเริ่มต้นช่วงที่ 2
     * @param {Date} end2 - เวลาสิ้นสุดช่วงที่ 2
     * @returns {boolean} true ถ้าทับซ้อน
     */
    hasTimeOverlap(start1, end1, start2, end2) {
        return start1 < end2 && end1 > start2;
    }

    /**
     * ตรวจสอบว่าไม่มีเวลาทับซ้อนกับ TimeEntry ที่มีอยู่
     * @param {Array} entries - entries ที่มี startTime, endTime, employeeId, timeIn, timeOut แล้ว
     * @param {Array} excludeEntryIds - ID ของ entries ที่จะยกเว้น (สำหรับ update)
     * @param {Object} tx - Prisma transaction client (optional)
     * @throws {HttpError} ถ้ามีการทับซ้อน
     */
    async validateNoOverlaps(entries, excludeEntryIds = [], tx = null) {
        const client = tx || prisma;

        // Group entries by employee
        const entriesByEmployee = {};
        for (const entry of entries) {
            if (!entriesByEmployee[entry.employeeId]) {
                entriesByEmployee[entry.employeeId] = [];
            }
            entriesByEmployee[entry.employeeId].push(entry);
        }

        // Check for each employee
        for (const [employeeId, employeeEntries] of Object.entries(entriesByEmployee)) {
            // Check overlaps within the new entries themselves
            for (let i = 0; i < employeeEntries.length; i++) {
                for (let j = i + 1; j < employeeEntries.length; j++) {
                    const a = employeeEntries[i];
                    const b = employeeEntries[j];
                    if (this.hasTimeOverlap(a.startTime, a.endTime, b.startTime, b.endTime)) {
                        throw err.conflict(
                            {
                                employeeId: Number(employeeId),
                                entry1: { timeIn: a.timeIn, timeOut: a.timeOut },
                                entry2: { timeIn: b.timeIn, timeOut: b.timeOut },
                            },
                            'มีช่วงเวลาทับซ้อนในรายการที่ส่งมา'
                        );
                    }
                }
            }

            // Check overlaps with existing entries in database
            const minTime = employeeEntries.reduce((min, e) =>
                e.startTime < min ? e.startTime : min, employeeEntries[0].startTime);
            const maxTime = employeeEntries.reduce((max, e) =>
                e.endTime > max ? e.endTime : max, employeeEntries[0].endTime);

            const whereClause = {
                employeeId: Number(employeeId),
                AND: [
                    { startTime: { lt: maxTime } },
                    { endTime: { gt: minTime } },
                ],
            };

            if (excludeEntryIds.length > 0) {
                whereClause.id = { notIn: excludeEntryIds };
            }

            const existingEntries = await client.timeEntry.findMany({
                where: whereClause,
                select: {
                    id: true,
                    startTime: true,
                    endTime: true,
                    timeSheet: {
                        select: {
                            id: true,
                            workDate: true,
                        },
                    },
                },
            });

            for (const entry of employeeEntries) {
                for (const existing of existingEntries) {
                    if (this.hasTimeOverlap(entry.startTime, entry.endTime, existing.startTime, existing.endTime)) {
                        throw err.conflict(
                            {
                                employeeId: Number(employeeId),
                                newEntry: { timeIn: entry.timeIn, timeOut: entry.timeOut },
                                conflictingEntry: {
                                    id: existing.id,
                                    startTime: existing.startTime,
                                    endTime: existing.endTime,
                                    timeSheetId: existing.timeSheet.id,
                                },
                            },
                            `พนักงานมีเวลาทำงานทับซ้อนกับรายการที่มีอยู่แล้ว (TimeEntry ID: ${existing.id})`
                        );
                    }
                }
            }
        }
    }
}

export default new TimeSheetService();

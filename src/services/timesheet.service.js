import prisma from "../databases/prisma.js";
import err from "../utils/error.js";
import { combineDateAndTime, toLocalDate, toLocalTime } from "../utils/date.js";
import prismaSelectDefault from "../utils/prismaSelectDefault.js";

/**
 * @typedef {Object} TimeSheet
 * @property {number} id - TimeSheet ID
 * @property {string} sheetType - ประเภท (DAILY, MONTHLY)
 * @property {Date|null} workDate - วันทำงาน (DAILY)
 * @property {string|null} monthPeriod - เดือน (MONTHLY) "YYYY-MM"
 * @property {string} status - สถานะ (PENDING, FILLED)
 * @property {Array|null} files - ไฟล์แนบ (JSON array ของ S3 paths)
 * @property {Object|null} workLeader - ข้อมูลหัวหน้างาน (DAILY)
 * @property {Object|null} employee - ข้อมูลพนักงาน (MONTHLY)
 */

/**
 * Service สำหรับจัดการใบเซ็นชื่อ
 */
class TimeSheetService {
    // ============================================
    // Private Helper Methods
    // ============================================

    /**
     * ตรวจสอบกฎของ workType
     * - REGULAR: otRate=0, accommodation=0, requires timeIn/timeOut
     * - OVERTIME: otRate>0, accommodation=0, requires timeIn/timeOut
     * - ACCOMMODATION: otRate=0, accommodation>0, NO timeIn/timeOut
     * @param {Object} data - ข้อมูลที่ต้องการ validate
     * @param {Date|null} startTime - เวลาเริ่มต้น (null ถ้าไม่มี)
     * @param {Date|null} endTime - เวลาสิ้นสุด (null ถ้าไม่มี)
     * @throws {HttpError} ถ้าไม่ผ่าน validation
     */
    _validateWorkTypeRules(data, startTime, endTime) {
        const workType = data.workType || 'REGULAR';
        const otRate = data.otRate ?? 0;
        const accommodation = data.accommodation ?? 0;
        const hasTime = startTime !== null && endTime !== null;

        if (workType === 'REGULAR') {
            if (otRate !== 0) {
                throw err.validation({
                    message: 'REGULAR: otRate ต้องเป็น 0',
                });
            }
            if (accommodation !== 0) {
                throw err.validation({
                    message: 'REGULAR: accommodation ต้องเป็น 0',
                });
            }
            if (!hasTime) {
                throw err.validation({
                    message: 'REGULAR: ต้องระบุ timeIn และ timeOut',
                });
            }
        }

        if (workType === 'OVERTIME') {
            if (otRate <= 0) {
                throw err.validation({
                    message: 'OVERTIME: otRate ต้องมากกว่า 0',
                });
            }
            if (accommodation !== 0) {
                throw err.validation({
                    message: 'OVERTIME: accommodation ต้องเป็น 0',
                });
            }
            if (!hasTime) {
                throw err.validation({
                    message: 'OVERTIME: ต้องระบุ timeIn และ timeOut',
                });
            }
        }

        if (workType === 'ACCOMMODATION') {
            if (otRate !== 0) {
                throw err.validation({
                    message: 'ACCOMMODATION: otRate ต้องเป็น 0',
                });
            }
            if (accommodation <= 0) {
                throw err.validation({
                    message: 'ACCOMMODATION: accommodation ต้องมากกว่า 0',
                });
            }
            if (hasTime) {
                throw err.validation({
                    message: 'ACCOMMODATION: ไม่ต้องระบุ timeIn และ timeOut',
                });
            }
        }
    }

    /**
     * ตรวจสอบว่าช่วงเวลาสองช่วงทับซ้อนกันหรือไม่
     * Overlap: start1 < end2 AND end1 > start2
     * @param {Date} start1 - เวลาเริ่มต้นช่วงที่ 1
     * @param {Date} end1 - เวลาสิ้นสุดช่วงที่ 1
     * @param {Date} start2 - เวลาเริ่มต้นช่วงที่ 2
     * @param {Date} end2 - เวลาสิ้นสุดช่วงที่ 2
     * @returns {boolean} true ถ้าทับซ้อน
     */
    _hasTimeOverlap(start1, end1, start2, end2) {
        return start1 < end2 && end1 > start2;
    }

    /**
     * ตรวจสอบว่าไม่มีเวลาทับซ้อนกับ TimeEntry ที่มีอยู่ (Single Query Version)
     * @param {Array} entries - entries ที่มี startTime, endTime, employeeId, timeIn, timeOut แล้ว
     * @param {Array} excludeEntryIds - ID ของ entries ที่จะยกเว้น (สำหรับ update)
     * @param {Object} tx - Prisma transaction client (optional)
     * @throws {HttpError} ถ้ามีการทับซ้อน (รวมรายการที่ซ้ำทั้งหมด)
     */
    async _validateNoOverlaps(entries, excludeEntryIds = [], tx = null) {
        const client = tx || prisma;
        const conflicts = [];

        // Group entries by employee
        const entriesByEmployee = {};
        for (const entry of entries) {
            if (!entriesByEmployee[entry.employeeId]) {
                entriesByEmployee[entry.employeeId] = [];
            }
            entriesByEmployee[entry.employeeId].push(entry);
        }

        // Check overlaps within the new entries themselves
        for (const [employeeId, employeeEntries] of Object.entries(entriesByEmployee)) {
            for (let i = 0; i < employeeEntries.length; i++) {
                for (let j = i + 1; j < employeeEntries.length; j++) {
                    const a = employeeEntries[i];
                    const b = employeeEntries[j];
                    if (this._hasTimeOverlap(a.startTime, a.endTime, b.startTime, b.endTime)) {
                        conflicts.push({
                            type: 'INTERNAL_OVERLAP',
                            employeeId: Number(employeeId),
                            entry1: {
                                date: toLocalDate(a.startTime),
                                timeIn: a.timeIn,
                                timeOut: a.timeOut,
                            },
                            entry2: {
                                date: toLocalDate(b.startTime),
                                timeIn: b.timeIn,
                                timeOut: b.timeOut,
                            },
                        });
                    }
                }
            }
        }

        // Single query for all employees (optimized: N queries → 1 query)
        const allEmployeeIds = Object.keys(entriesByEmployee).map(Number);

        // Find global min/max time range
        const allTimes = entries.flatMap((e) => [e.startTime, e.endTime]);
        const globalMinTime = new Date(Math.min(...allTimes));
        const globalMaxTime = new Date(Math.max(...allTimes));

        const whereClause = {
            employeeId: { in: allEmployeeIds },
            workType: { in: ['REGULAR', 'OVERTIME'] },
            AND: [
                { startTime: { lt: globalMaxTime } },
                { endTime: { gt: globalMinTime } },
            ],
        };

        if (excludeEntryIds.length > 0) {
            whereClause.id = { notIn: excludeEntryIds };
        }

        const existingEntries = await client.timeEntry.findMany({
            where: whereClause,
            select: {
                id: true,
                employeeId: true,
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

        // Group existing entries by employee for O(1) lookup
        const existingByEmployee = {};
        for (const existing of existingEntries) {
            if (!existingByEmployee[existing.employeeId]) {
                existingByEmployee[existing.employeeId] = [];
            }
            existingByEmployee[existing.employeeId].push(existing);
        }

        // Check overlaps with existing entries
        for (const [employeeId, employeeEntries] of Object.entries(entriesByEmployee)) {
            const existingForEmployee = existingByEmployee[employeeId] || [];

            for (const entry of employeeEntries) {
                for (const existing of existingForEmployee) {
                    if (this._hasTimeOverlap(entry.startTime, entry.endTime, existing.startTime, existing.endTime)) {
                        conflicts.push({
                            type: 'DATABASE_OVERLAP',
                            employeeId: Number(employeeId),
                            date: toLocalDate(entry.startTime),
                            newEntry: {
                                date: toLocalDate(entry.startTime),
                                timeIn: entry.timeIn,
                                timeOut: entry.timeOut,
                            },
                            conflictingEntry: {
                                id: existing.id,
                                startTime: existing.startTime,
                                endTime: existing.endTime,
                                timeSheetId: existing.timeSheet.id,
                            },
                        });
                    }
                }
            }
        }

        // Throw error with all conflicts if any found
        if (conflicts.length > 0) {
            throw err.conflict(
                { conflicts, totalConflicts: conflicts.length },
                `พบช่วงเวลาทับซ้อน ${conflicts.length} รายการ`
            );
        }
    }

    /**
     * ตรวจสอบว่าไม่มี ACCOMMODATION ซ้ำในเดือนนั้น
     * @param {number} employeeId - ID พนักงาน
     * @param {string} monthPeriod - เดือน "YYYY-MM"
     * @param {Array} accommodationDates - วันที่ ["2024-01-01", "2024-01-05"]
     * @param {Array} excludeEntryIds - ID ของ entries ที่จะยกเว้น
     * @param {Object} tx - Prisma transaction client (optional)
     * @throws {HttpError} ถ้ามี ACCOMMODATION ซ้ำ
     */
    async _validateNoAccommodationDuplicates(employeeId, monthPeriod, accommodationDates, excludeEntryIds = [], tx = null) {
        if (!accommodationDates || accommodationDates.length === 0) return;

        const client = tx || prisma;

        // Check internal duplicates
        const seen = new Set();
        const internalDuplicates = [];
        for (const date of accommodationDates) {
            if (seen.has(date)) {
                internalDuplicates.push({ date });
            } else {
                seen.add(date);
            }
        }

        if (internalDuplicates.length > 0) {
            throw err.conflict(
                { duplicates: internalDuplicates, totalDuplicates: internalDuplicates.length },
                `พบ ACCOMMODATION ซ้ำ ${internalDuplicates.length} รายการในข้อมูลที่ส่งมา`
            );
        }

        // Query existing ACCOMMODATION entries
        const whereClause = {
            employeeId,
            workType: 'ACCOMMODATION',
            timeSheet: { monthPeriod },
        };
        if (excludeEntryIds.length > 0) {
            whereClause.id = { notIn: excludeEntryIds };
        }

        const existingEntries = await client.timeEntry.findMany({
            where: whereClause,
            select: { id: true, startTime: true },
        });

        // Check duplicates with database
        const existingDates = new Set(
            existingEntries.map((e) => toLocalDate(e.startTime))
        );

        const duplicates = [];
        for (const date of accommodationDates) {
            if (existingDates.has(date)) {
                duplicates.push({ date });
            }
        }

        if (duplicates.length > 0) {
            throw err.conflict(
                { duplicates, totalDuplicates: duplicates.length },
                `พบ ACCOMMODATION ซ้ำ ${duplicates.length} รายการกับข้อมูลที่มีอยู่`
            );
        }
    }

    // ============================================
    // Public Methods
    // ============================================

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

        if (query.startDate && query.endDate) {
            where.workDate = {
                gte: combineDateAndTime(query.startDate, '00:00:00'),
                lte: combineDateAndTime(query.endDate, '23:59:59'),
            };
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
                        select: {
                            timeEntries: {
                                where: { isNegative: false },
                            },
                        },
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
                    select: prismaSelectDefault.timeEntry,
                    orderBy: { id: 'asc' },
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
    async createWorkerTimeSheet({ workLeaderId, workDate, allowDuplicate, pattern, entries, createBy }) {
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
        const workDateObj = combineDateAndTime(workDate, "00:00:00");
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
            await this._validateNoOverlaps(entriesWithDateTime, [], tx);

            // Create TimeSheet
            const timeSheet = await tx.timeSheet.create({
                data: {
                    workLeaderId,
                    workDate: workDateObj,
                    sheetType: 'DAILY',
                    status: 'PENDING',
                    createBy,
                },
                select: prismaSelectDefault.timeSheet,
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
                            shiftType: entry.shiftType,
                            workType,
                            otRate,
                            accommodation: 0,
                            isNegative: false,
                        },
                        select: prismaSelectDefault.timeEntry,
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
     * สร้าง TimeSheet สำหรับ Driver (Monthly)
     * @param {Object} params - ข้อมูล TimeSheet และ Entries
     * @param {number} params.employeeId - ID พนักงาน
     * @param {string} params.monthPeriod - เดือน "YYYY-MM"
     * @param {boolean} params.allowDuplicate - อนุญาตให้สร้างซ้ำได้
     * @param {Array} params.entries - รายการเวลาทำงาน
     * @param {number} params.createBy - User ID ที่สร้าง
     * @returns {Promise<Object>} ข้อมูล TimeSheet พร้อม TimeEntries
     */
    async createDriverTimeSheet({ employeeId, monthPeriod, allowDuplicate, entries, createBy }) {
        // 1. Validate employee exists
        const employee = await prisma.employee.findUnique({
            where: { id: employeeId },
            select: { id: true },
        });
        if (!employee) {
            throw err.notFound({ employeeId }, 'ไม่พบพนักงาน');
        }

        // 2. Build entries with full datetime
        const entriesWithDateTime = entries.map((entry) => {
            if (entry.workType === 'ACCOMMODATION') {
                return {
                    ...entry,
                    startTime: combineDateAndTime(entry.date, '00:00:00'),
                    endTime: null,
                };
            }
            return {
                ...entry,
                startTime: combineDateAndTime(entry.date, entry.timeIn),
                endTime: combineDateAndTime(entry.date, entry.timeOut),
            };
        });

        // 3. Separate entries by type
        const timeEntries = entriesWithDateTime.filter((e) => e.workType !== 'ACCOMMODATION');
        const accommodationEntries = entriesWithDateTime.filter((e) => e.workType === 'ACCOMMODATION');

        // 4. Validate overlaps (reuse existing function)
        if (timeEntries.length > 0) {
            await this._validateNoOverlaps(
                timeEntries.map((e) => ({
                    employeeId,
                    startTime: e.startTime,
                    endTime: e.endTime,
                    timeIn: e.timeIn,
                    timeOut: e.timeOut,
                }))
            );
        }

        // 5. Validate accommodation duplicates
        if (accommodationEntries.length > 0) {
            await this._validateNoAccommodationDuplicates(
                employeeId,
                monthPeriod,
                accommodationEntries.map((e) => e.date)
            );
        }

        // 6. Create timesheet + entries in transaction
        const result = await prisma.$transaction(async (tx) => {
            // Check for duplicate if allowDuplicate is false
            if (!allowDuplicate) {
                const existingSheet = await tx.timeSheet.findFirst({
                    where: {
                        employeeId,
                        monthPeriod,
                    },
                    select: { id: true },
                });
                if (existingSheet) {
                    throw err.conflict(
                        { employeeId, monthPeriod },
                        'มีการลงเวลาสำหรับพนักงานและเดือนนี้แล้ว หากต้องการสร้างซ้ำ กรุณายืนยันการสร้าง'
                    );
                }
            }

            const timeSheet = await tx.timeSheet.create({
                data: {
                    employeeId,
                    monthPeriod,
                    sheetType: 'MONTHLY',
                    status: 'PENDING',
                    createBy,
                },
                select: {
                    id: true,
                    sheetType: true,
                    monthPeriod: true,
                    status: true,
                    createdAt: true,
                },
            });

            const createdEntries = await Promise.all(
                entriesWithDateTime.map((entry) =>
                    tx.timeEntry.create({
                        data: {
                            timeSheetId: timeSheet.id,
                            employeeId,
                            startTime: entry.startTime,
                            endTime: entry.endTime,
                            workType: entry.workType,
                            otRate: entry.otRate || 0,
                            accommodation: entry.accommodation || 0,
                            shiftType: 'REGULAR',
                            isNegative: false,
                        },
                        select: prismaSelectDefault.timeEntry,
                    })
                )
            );

            return { ...timeSheet, timeEntries: createdEntries };
        });

        return result;
    }

    /**
     * อัปเดตสถานะ TimeSheet (status only)
     * @param {number} id - TimeSheet ID
     * @param {string} status - สถานะใหม่ (PENDING, FILLED)
     * @returns {Promise<TimeSheet>} ข้อมูล TimeSheet ที่อัปเดตแล้ว
     * @throws {AppError} ไม่พบ TimeSheet (notFound)
     */
    async updateTimeSheetStatus(id, status) {
        // ตรวจสอบว่ามี timeSheet อยู่จริง
        const timeSheet = await prisma.timeSheet.findUnique({
            where: { id },
            select: { id: true, status: true },
        });

        if (!timeSheet) {
            throw err.notFound({ id });
        }

        const updated = await prisma.timeSheet.update({
            where: { id },
            data: { status },
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

    // ============================================
    // Correction Methods (Negative Entry)
    // ============================================

    /**
     * สร้าง negative TimeEntry สำหรับแก้ไขย้อนหลัง
     * - ผูกกับ timesheet เดียวกันกับ entry เดิม
     * - copy shiftType, workType, otRate จาก entry เดิม
     * @param {number} timeSheetId - TimeSheet ID
     * @param {Object} data - ข้อมูล correction
     * @param {number} data.originalEntryId - ID ของ entry เดิมที่ต้องการแก้ไข
     * @param {string} data.timeIn - เวลาเริ่มต้นของช่วงที่ต้องการหักล้าง
     * @param {string} data.timeOut - เวลาสิ้นสุดของช่วงที่ต้องการหักล้าง
     * @param {string} [data.note] - หมายเหตุ
     * @param {number} data.createBy - User ID ที่สร้าง
     * @returns {Promise<Object>} ข้อมูล TimeEntry ที่สร้าง
     */
    async createCorrectionTimeEntry(timeSheetId, data) {
        // 1. Validate timesheet exists
        const timeSheet = await prisma.timeSheet.findUnique({
            where: { id: timeSheetId },
            select: { id: true, status: true },
        });

        if (!timeSheet) {
            throw err.notFound({ id: timeSheetId }, 'ไม่พบใบลงเวลา');
        }

        // 2. Find original entry
        const originalEntry = await prisma.timeEntry.findUnique({
            where: { id: data.originalEntryId },
            select: {
                id: true,
                timeSheetId: true,
                employeeId: true,
                startTime: true,
                endTime: true,
                shiftType: true,
                workType: true,
                otRate: true,
                paidValue: true,
                paidDate: true,
            },
        });

        if (!originalEntry) {
            throw err.notFound({ originalEntryId: data.originalEntryId }, 'ไม่พบรายการเวลาเดิม');
        }

        if (originalEntry.timeSheetId !== timeSheetId) {
            throw err.validation({ message: 'รายการเวลาเดิมไม่ได้อยู่ในใบลงเวลานี้' });
        }

        if (originalEntry.isNegative) {
            throw err.validation({ message: 'ไม่สามารถแก้ไขรายการที่เป็นค่าติดลบได้' });
        }

        // 3. Check paid status
        if (originalEntry.paidDate === null) {
            throw err.validation({
                message: 'รายการนี้ยังไม่ได้จ่ายเงิน กรุณาแก้ไขรายการเวลาโดยตรงแทนการทำ correction',
            });
        }

        // 4. Build DateTime and validate containment
        const startTime = combineDateAndTime(toLocalDate(originalEntry.startTime), data.timeIn);
        const endTime = combineDateAndTime(toLocalDate(originalEntry.startTime), data.timeOut);

        // Negative range must be within original entry's range
        if (startTime < originalEntry.startTime || endTime > originalEntry.endTime) {
            throw err.validation({
                message: 'ช่วงเวลาต้องอยู่ภายในรายการเดิม (' +
                    toLocalTime(originalEntry.startTime) + '-' +
                    toLocalTime(originalEntry.endTime) + ')',
            });
        }

        // 5. Validate no overlap with existing negative entries for this employee
        const overlappingNegative = await prisma.timeEntry.findFirst({
            where: {
                employeeId: originalEntry.employeeId,
                isNegative: true,
                referenceEntryId: originalEntry.id,
                startTime: { lt: endTime },
                endTime: { gt: startTime },
            },
            select: { id: true, startTime: true, endTime: true },
        });

        if (overlappingNegative) {
            throw err.conflict(
                { existingNegativeEntry: overlappingNegative },
                'มีรายการแก้ไขที่ซ้อนทับกับช่วงเวลานี้อยู่แล้ว'
            );
        }

        // 6. Create negative entry
        return prisma.timeEntry.create({
            data: {
                timeSheetId,
                employeeId: originalEntry.employeeId,
                startTime,
                endTime,
                shiftType: originalEntry.shiftType,
                workType: originalEntry.workType,
                otRate: originalEntry.otRate,
                accommodation: 0,
                isNegative: true,
                referenceEntryId: originalEntry.id,
                createBy: data.createBy,
                note: data.note || null,
            },
            select: prismaSelectDefault.timeEntry,
        });
    }

    /**
     * ลบ TimeSheet (เฉพาะ PENDING เท่านั้น)
     * @param {number} id - TimeSheet ID
     * @throws {AppError} ไม่พบ TimeSheet หรือไม่ใช่สถานะ PENDING
     */
    async deleteTimeSheet(id) {
        const timeSheet = await prisma.timeSheet.findUnique({
            where: { id },
            select: { id: true, status: true },
        });

        if (!timeSheet) {
            throw err.notFound({ id });
        }

        if (timeSheet.status !== 'PENDING') {
            throw err.validation({
                message: 'สามารถลบได้เฉพาะ TimeSheet ที่มีสถานะ PENDING เท่านั้น',
            });
        }

        // Prisma schema มี onDelete: Cascade สำหรับ entries จะถูกลบอัตโนมัติ
        await prisma.timeSheet.delete({ where: { id } });
    }

    // ============================================
    // Worker TimeEntry Methods (DAILY timesheet only)
    // ============================================

    /**
     * เพิ่ม TimeEntry สำหรับ Worker (DAILY)
     * - ใช้ pattern จาก entry แรกใน timesheet
     * - ห้ามระบุ workType/otRate เอง
     * @param {number} timeSheetId - TimeSheet ID
     * @param {Object} data - ข้อมูล TimeEntry (employeeId, timeIn, timeOut, shiftType, note)
     * @returns {Promise<Object>} ข้อมูล TimeEntry ที่สร้าง
     */
    async createWorkerTimeEntry(timeSheetId, data) {
        // 1. ตรวจสอบ timesheet เป็น DAILY และไม่ได้ FILLED
        const timeSheet = await prisma.timeSheet.findUnique({
            where: { id: timeSheetId },
            select: prismaSelectDefault.timeSheet,
        });

        if (!timeSheet) {
            throw err.notFound({ id: timeSheetId }, 'ไม่พบใบลงเวลา');
        }

        if (timeSheet.sheetType !== 'DAILY') {
            throw err.validation({ message: 'Endpoint นี้สำหรับใบลงเวลาประเภทคนงานเท่านั้น' });
        }

        if (timeSheet.status === 'FILLED') {
            throw err.validation({ message: 'ใบลงเวลายืนยันแล้ว ไม่สามารถเพิ่มรายการได้' });
        }

        // 2. Validate employee exists
        const employee = await prisma.employee.findUnique({
            where: { id: data.employeeId },
            select: { id: true },
        });
        if (!employee) {
            throw err.notFound({ employeeId: data.employeeId }, 'ไม่พบพนักงาน');
        }

        // 3. ดึง pattern จาก entry แรกใน timesheet
        const firstEntry = await prisma.timeEntry.findFirst({
            where: { timeSheetId },
            select: { workType: true, otRate: true },
            orderBy: { id: 'asc' },
        });

        // ถ้ายังไม่มี entry → throw error (ต้องสร้าง timesheet พร้อม entries ก่อน)
        if (!firstEntry) {
            throw err.validation({
                message: 'ใบลงเวลายังไม่มีรายการ กรุณาสร้างใหม่พร้อมรายการเวลา',
            });
        }

        // 4. Build DateTime objects
        const startTime = combineDateAndTime(timeSheet.workDate, data.timeIn);
        const endTime = combineDateAndTime(timeSheet.workDate, data.timeOut);

        // 5. Check for time overlaps
        await this._validateNoOverlaps([{
            employeeId: data.employeeId,
            startTime,
            endTime,
            timeIn: data.timeIn,
            timeOut: data.timeOut,
        }]);

        // 6. Create entry with pattern from first entry
        return prisma.timeEntry.create({
            data: {
                timeSheetId,
                employeeId: data.employeeId,
                startTime,
                endTime,
                shiftType: data.shiftType || 'REGULAR',
                workType: firstEntry.workType,
                otRate: firstEntry.otRate,
                accommodation: 0,
                isNegative: false,
                note: data.note || null,
            },
            select: prismaSelectDefault.timeEntry,
        });
    }

    /**
     * อัปเดต TimeEntry สำหรับ Worker (DAILY)
     * - แก้ไขได้แค่ timeIn, timeOut, note
     * - ห้ามเปลี่ยน workType, otRate (pattern ร่วมกัน)
     * @param {number} timeSheetId - TimeSheet ID
     * @param {number} entryId - TimeEntry ID
     * @param {Object} data - ข้อมูลที่จะอัปเดต (timeIn, timeOut, note)
     * @returns {Promise<Object>} ข้อมูล TimeEntry ที่อัปเดต
     */
    async updateWorkerTimeEntry(timeSheetId, entryId, data) {
        // 1. Validate timesheet
        const timeSheet = await prisma.timeSheet.findUnique({
            where: { id: timeSheetId },
            select: prismaSelectDefault.timeSheet,
        });

        if (!timeSheet) {
            throw err.notFound({ id: timeSheetId }, 'ไม่พบใบลงเวลา');
        }

        if (timeSheet.sheetType !== 'DAILY') {
            throw err.validation({ message: 'Endpoint นี้สำหรับใบลงเวลาประเภทคนงานเท่านั้น' });
        }

        if (timeSheet.status === 'FILLED') {
            throw err.validation({ message: 'ใบลงเวลายืนยันแล้ว ไม่สามารถแก้ไขได้' });
        }

        // 2. Validate entry exists and belongs to timesheet
        const entry = await prisma.timeEntry.findUnique({
            where: { id: entryId },
            select: { id: true, timeSheetId: true, employeeId: true },
        });

        if (!entry || entry.timeSheetId !== timeSheetId) {
            throw err.notFound({ entryId }, 'ไม่พบรายการเวลา');
        }

        // 3. Build new DateTime
        const startTime = combineDateAndTime(timeSheet.workDate, data.timeIn);
        const endTime = combineDateAndTime(timeSheet.workDate, data.timeOut);

        // 4. Check for overlaps
        await this._validateNoOverlaps([{
            employeeId: entry.employeeId,
            startTime,
            endTime,
            timeIn: data.timeIn,
            timeOut: data.timeOut,
        }], [entryId]);

        // 5. Update (เฉพาะ timeIn, timeOut, note)
        return prisma.timeEntry.update({
            where: { id: entryId },
            data: {
                startTime,
                endTime,
                shiftType: data.shiftType,
                note: data.note,
            },
            select: prismaSelectDefault.timeEntry,
        });
    }

    // ============================================
    // Driver TimeEntry Methods (MONTHLY timesheet only)
    // ============================================

    /**
     * เพิ่ม TimeEntry สำหรับ Driver (MONTHLY)
     * - ระบุ workType, otRate, accommodation เองได้
     * @param {number} timeSheetId - TimeSheet ID
     * @param {Object} data - ข้อมูล TimeEntry
     * @returns {Promise<Object>} ข้อมูล TimeEntry ที่สร้าง
     */
    async createDriverTimeEntry(timeSheetId, data) {
        // 1. Validate timesheet เป็น MONTHLY (read-only checks, ไม่ต้องใส่ transaction)
        const timeSheet = await prisma.timeSheet.findUnique({
            where: { id: timeSheetId },
            select: {
                ...prismaSelectDefault.timeSheet,
                employeeId: true,
            },
        });

        if (!timeSheet) {
            throw err.notFound({ id: timeSheetId }, 'ไม่พบใบลงเวลา');
        }

        if (timeSheet.sheetType !== 'MONTHLY') {
            throw err.validation({ message: 'Endpoint นี้สำหรับใบลงเวลาประเภทคนขับรถเท่านั้น' });
        }

        if (timeSheet.status === 'FILLED') {
            throw err.validation({ message: 'ใบลงเวลายืนยันแล้ว ไม่สามารถเพิ่มรายการได้' });
        }

        // 2. Execute validation + create in transaction
        return prisma.$transaction(async (tx) => {
            // Build DateTime based on workType
            let startTime = null;
            let endTime = null;

            if (data.workType === 'ACCOMMODATION') {
                startTime = combineDateAndTime(data.date, '00:00:00');
                endTime = null;

                // Validate no duplicate accommodation
                await this._validateNoAccommodationDuplicates(
                    timeSheet.employeeId,
                    timeSheet.monthPeriod,
                    [data.date],
                    [],
                    tx
                );
            } else {
                startTime = combineDateAndTime(data.date, data.timeIn);
                endTime = combineDateAndTime(data.date, data.timeOut);

                // Validate no overlaps
                await this._validateNoOverlaps([{
                    employeeId: timeSheet.employeeId,
                    startTime,
                    endTime,
                    timeIn: data.timeIn,
                    timeOut: data.timeOut,
                }], [], tx);
            }

            // Validate workType rules
            this._validateWorkTypeRules(data, startTime, endTime);

            // Create entry
            return tx.timeEntry.create({
                data: {
                    timeSheetId,
                    employeeId: timeSheet.employeeId,
                    startTime,
                    endTime,
                    shiftType: 'REGULAR',
                    workType: data.workType,
                    otRate: data.otRate ?? 0,
                    accommodation: data.accommodation ?? 0,
                    isNegative: false,
                    note: data.note || null,
                },
                select: prismaSelectDefault.timeEntry,
            });
        });
    }

    /**
     * อัปเดต TimeEntry สำหรับ Driver (MONTHLY)
     * - แก้ไข timeIn, timeOut, otRate, accommodation, note ได้
     * - ห้ามเปลี่ยน workType
     * @param {number} timeSheetId - TimeSheet ID
     * @param {number} entryId - TimeEntry ID
     * @param {Object} data - ข้อมูลที่จะอัปเดต
     * @returns {Promise<Object>} ข้อมูล TimeEntry ที่อัปเดต
     */
    async updateDriverTimeEntry(timeSheetId, entryId, data) {
        // 1. Validate timesheet
        const timeSheet = await prisma.timeSheet.findUnique({
            where: { id: timeSheetId },
            select: prismaSelectDefault.timeSheet,
        });

        if (!timeSheet) {
            throw err.notFound({ id: timeSheetId }, 'ไม่พบใบลงเวลา');
        }

        if (timeSheet.sheetType !== 'MONTHLY') {
            throw err.validation({ message: 'Endpoint นี้สำหรับใบลงเวลาประเภทคนขับรถเท่านั้น' });
        }

        if (timeSheet.status === 'FILLED') {
            throw err.validation({ message: 'ใบลงเวลายืนยันแล้ว ไม่สามารถแก้ไขได้' });
        }

        // 2. Validate entry
        const entry = await prisma.timeEntry.findUnique({
            where: { id: entryId },
            select: {
                ...prismaSelectDefault.timeEntry,
                timeSheetId: true,
            },
        });

        if (!entry || entry.timeSheetId !== timeSheetId) {
            throw err.notFound({ entryId }, 'ไม่พบรายการเวลา');
        }

        // 3. Build update data
        const updateData = {};
        let finalStartTime = entry.startTime;
        let finalEndTime = entry.endTime;

        // Handle time updates (เฉพาะ REGULAR และ OVERTIME)
        if (entry.workType !== 'ACCOMMODATION') {
            if (data.timeIn !== undefined || data.timeOut !== undefined) {
                const dateStr = toLocalDate(entry.startTime);
                finalStartTime = data.timeIn ? combineDateAndTime(dateStr, data.timeIn) : entry.startTime;
                finalEndTime = data.timeOut ? combineDateAndTime(dateStr, data.timeOut) : entry.endTime;

                updateData.startTime = finalStartTime;
                updateData.endTime = finalEndTime;

                await this._validateNoOverlaps([{
                    employeeId: entry.employeeId,
                    startTime: finalStartTime,
                    endTime: finalEndTime,
                    timeIn: data.timeIn,
                    timeOut: data.timeOut,
                }], [entryId]);
            }
        }

        // Handle otRate/accommodation
        if (data.otRate !== undefined) {
            updateData.otRate = data.otRate;
        }
        if (data.accommodation !== undefined) {
            updateData.accommodation = data.accommodation;
        }
        if (data.note !== undefined) {
            updateData.note = data.note;
        }

        // 4. Validate workType rules
        const mergedData = {
            workType: entry.workType,
            otRate: data.otRate ?? entry.otRate,
            accommodation: data.accommodation ?? entry.accommodation,
        };

        this._validateWorkTypeRules(mergedData, finalStartTime, finalEndTime);

        // 5. Update
        return prisma.timeEntry.update({
            where: { id: entryId },
            data: updateData,
            select: {
                id: true,
                employeeId: true,
                startTime: true,
                endTime: true,
                shiftType: true,
                workType: true,
                otRate: true,
                accommodation: true,
                note: true,
                employee: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                    },
                },
            },
        });
    }

    /**
     * ลบ TimeEntry
     * @param {number} timeSheetId - TimeSheet ID
     * @param {number} entryId - TimeEntry ID
     */
    async deleteTimeEntry(timeSheetId, entryId) {
        // 1. ตรวจสอบ entry มีอยู่และเป็นของ timesheet นี้
        const entry = await prisma.timeEntry.findUnique({
            where: { id: entryId },
            select: { id: true, timeSheetId: true, isNegative: true, paidDate: true },
        });

        if (!entry || entry.timeSheetId !== timeSheetId) {
            throw err.notFound({ entryId }, 'ไม่พบรายการเวลา');
        }

        // 2. ตรวจสอบ paidDate (ทุกกรณีต้องยังไม่จ่ายเงิน)
        if (entry.paidDate !== null) {
            throw err.validation({
                message: 'รายการเวลาจ่ายเงินแล้ว ไม่สามารถลบได้',
            });
        }

        // 3. ตรวจสอบสถานะ timesheet แยกตามประเภท entry
        if (entry.isNegative) {
            // isNegative = true: ตรวจสอบเฉพาะ paidDate ของ entry (ผ่านแล้วขั้นตอนที่ 2)
            // อนุญาตให้ลบได้แม้ timesheet จะ FILLED เพราะอาจถูกสร้างหลังยืนยัน
        } else {
            // isNegative = false: ตรวจสอบเพิ่มเติมว่า timesheet ต้องไม่ FILLED
            const timeSheet = await prisma.timeSheet.findUnique({
                where: { id: timeSheetId },
                select: { id: true, status: true },
            });

            if (!timeSheet) {
                throw err.notFound({ id: timeSheetId }, 'ไม่พบ TimeSheet');
            }

            if (timeSheet.status === 'FILLED') {
                throw err.validation({
                    message: 'TimeSheet ยืนยันแล้ว ไม่สามารถลบได้',
                });
            }
        }

        // 4. Delete entry
        await prisma.timeEntry.delete({ where: { id: entryId } });
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

        return prisma.timeSheet.update({
            where: { id },
            data: { files: updatedFiles },
            select: {
                ...prismaSelectDefault.timeSheet,
                createdAt: true,
                updatedAt: true,
                files: true,
            },
        });
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

        return prisma.timeSheet.update({
            where: { id },
            data: { files: updatedFiles },
            select: {
                ...prismaSelectDefault.timeSheet,
                createdAt: true,
                updatedAt: true,
                files: true,
            },
        });
    }
}

export default new TimeSheetService();

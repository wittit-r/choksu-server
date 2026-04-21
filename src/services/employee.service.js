import prisma from "../databases/prisma.js";
import err from "../utils/error.js";
import prismaSelectDefault from "../utils/prismaSelectDefault.js";
import { combineDateAndTime, toLocalDate, toLocalTime, formatMinutesToHours } from "../utils/date.js";

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
 * @typedef {Object} Employee
 * @property {string} id - Employee ID (UUID)
 * @property {string} firstName - ชื่อจริง
 * @property {string} lastName - นามสกุล
 * @property {string} idCard - เลขบัตรประชาชน
 * @property {string} [phone] - เบอร์โทรศัพท์
 * @property {string} [bankAccount] - เลขบัญชีธนาคาร
 * @property {string} shiftType - ประเภทการทำงาน (REGULAR, SHIFT)
 * @property {Object|null} position - ข้อมูลตำแหน่งงาน (ดึงจาก WageRate ที่ active, มี employeeType อยู่ข้างใน)
 * @property {string} [workLeaderId] - ID ของหัวหน้างาน
 * @property {Object} [workLeader] - ข้อมูลหัวหน้างาน
 * @property {Date} [startDate] - วันที่เริ่มงาน
 * @property {boolean} isActive - สถานะการใช้งาน
 * @property {Date} createdAt - วันที่สร้าง
 * @property {Date} updatedAt - วันที่อัปเดต
 */

/**
 * @typedef {Object} WageRate
 * @property {string} id - WageRate ID (UUID)
 * @property {string} employeeId - Employee ID
 * @property {string} positionId - Position ID
 * @property {Object} position - ข้อมูลตำแหน่งงาน
 * @property {number} [dailyRate] - ค่าแรงรายวัน
 * @property {number} [hourlyRate] - ค่าแรงรายชั่วโมง
 * @property {number} [minuteRate] - ค่าแรงรายนาที
 * @property {number} [monthlyRate] - เงินเดือนรายเดือน
 * @property {Date} effectiveFrom - วันที่เริ่มมีผล
 * @property {Date} [effectiveTo] - วันที่สิ้นสุดผล
 * @property {string} [note] - หมายเหตุ
 * @property {Date} createdAt - วันที่สร้าง
 * @property {Date} updatedAt - วันที่อัปเดต
 */

/**
 * @typedef {Object} EmployeeCreateData
 * @property {string} firstName - ชื่อจริง
 * @property {string} lastName - นามสกุล
 * @property {string} idCard - เลขบัตรประชาชน
 * @property {string} [phone] - เบอร์โทรศัพท์
 * @property {string} [bankAccount] - เลขบัญชีธนาคาร
 * @property {string} shiftType - ประเภทการทำงาน
 * @property {string} [workLeaderId] - ID ของหัวหน้างาน
 * @property {string} startDate - วันที่เริ่มงาน (ISO string)
 */

/**
 * @typedef {Object} EmployeeUpdateData
 * @property {string} [firstName] - ชื่อจริง
 * @property {string} [lastName] - นามสกุล
 * @property {string} [idCard] - เลขบัตรประชาชน
 * @property {string} [phone] - เบอร์โทรศัพท์
 * @property {string} [bankAccount] - เลขบัญชีธนาคาร
 * @property {string} [shiftType] - ประเภทการทำงาน
 * @property {string} [workLeaderId] - ID ของหัวหน้างาน
 * @property {string} [startDate] - วันที่เริ่มงาน (ISO string)
 * @property {boolean} [isActive] - สถานะการใช้งาน
 */

/**
 * @typedef {Object} WageCreateData
 * @property {string} employeeId - Employee ID
 * @property {string} positionId - Position ID
 * @property {number} [dailyRate] - ค่าแรงรายวัน
 * @property {number} [hourlyRate] - ค่าแรงรายชั่วโมง
 * @property {number} [minuteRate] - ค่าแรงรายนาที
 * @property {number} [monthlyRate] - เงินเดือนรายเดือน
 * @property {string} effectiveFrom - วันที่เริ่มมีผล (ISO string)
 * @property {string} [effectiveTo] - วันที่สิ้นสุดผล (ISO string)
 * @property {string} [note] - หมายเหตุ
 */

/**
 * @typedef {Object} WageUpdateData
 * @property {string} [positionId] - Position ID
 * @property {number} [dailyRate] - ค่าแรงรายวัน
 * @property {number} [hourlyRate] - ค่าแรงรายชั่วโมง
 * @property {number} [minuteRate] - ค่าแรงรายนาที
 * @property {number} [monthlyRate] - เงินเดือนรายเดือน
 * @property {string} [effectiveFrom] - วันที่เริ่มมีผล (ISO string)
 * @property {string} [effectiveTo] - วันที่สิ้นสุดผล (ISO string หรือ null)
 * @property {string} [note] - หมายเหตุ
 */

/**
 * Service สำหรับจัดการข้อมูลพนักงาน
 */
class EmployeeService {
    /**
     * Transform employee data - flatten position from wageRates
     * @private
     * @param {Object} employee - Employee data ที่มี wageRates array
     * @returns {Object} Employee data ที่มี position field แทน wageRates
     */
    _transformEmployee(employee) {
        const { wageRates, ...rest } = employee;
        return {
            ...rest,
            position: wageRates?.[0]?.position || null,
        };
    }

    /**
     * ตรวจสอบว่าตำแหน่งงานมีอยู่จริง
     * @private
     * @param {string} positionId - Position ID (UUID)
     * @returns {Promise<Object>} ข้อมูลตำแหน่งงาน
     * @throws {AppError} ไม่พบตำแหน่งงาน (validation)
     */
    async _validatePositionExists(positionId) {
        const position = await prisma.position.findUnique({
            where: { id: positionId },
            select: { id: true },
        });

        if (!position) {
            throw err.validation({ positionId: 'ไม่พบตำแหน่งงาน' });
        }

        return position;
    }

    /**
     * ดึงรายการพนักงานทั้งหมดพร้อม pagination
     * @param {Object} params - Query parameters
     * @param {number} params.page - หน้าปัจจุบัน
     * @param {number} params.limit - จำนวนรายการต่อหน้า
     * @param {'asc'|'desc'} params.sort - ทิศทางการเรียงลำดับ
     * @param {string} params.sortBy - ฟิลด์ที่ใช้เรียงลำดับ
     * @param {string} [params.search] - คำค้นหา (ค้นหาใน firstName, lastName, idCard, phone)
     * @param {boolean} [params.isActive] - กรองตามสถานะการใช้งาน
     * @param {string} [params.workLeaderId] - กรองตามหัวหน้างาน
     * @param {string} [params.branchId] - กรองตามสาขา
     * @param {number} [params.positionId] - กรองตามตำแหน่งงาน (จาก WageRate ที่ active)
     * @param {string} [params.employeeType] - กรองตามประเภทพนักงาน (จาก Position ที่ active)
     * @returns {Promise<PaginationResult>} รายการพนักงานพร้อม pagination
     */
    async getEmployees({ page, limit, sort, sortBy, ...query }) {
        const where = {};
        const now = new Date();

        if (query.search) {
            where.OR = [
                { firstName: { contains: query.search, mode: 'insensitive' } },
                { lastName: { contains: query.search, mode: 'insensitive' } },
                { idCard: query.search },
                { phone: query.search },
            ];
        }

        if (query.isActive !== undefined) {
            where.isActive = query.isActive;
        }

        if (query.workLeaderId !== undefined) {
            where.workLeaderId = query.workLeaderId;
        }

        if (query.branchId !== undefined) {
            where.workLeader = {
                branchId: query.branchId,
            };
        }

        // Filter by position (จาก WageRate ที่ active)
        if (query.positionId !== undefined) {
            where.wageRates = {
                some: {
                    positionId: query.positionId,
                    effectiveFrom: { lte: now },
                    OR: [
                        { effectiveTo: null },
                        { effectiveTo: { gte: now } },
                    ],
                },
            };
        }

        // Filter by employeeType (จาก Position ผ่าน WageRate ที่ active)
        if (query.employeeType !== undefined) {
            where.wageRates = {
                some: {
                    position: { employeeType: query.employeeType },
                    effectiveFrom: { lte: now },
                    OR: [
                        { effectiveTo: null },
                        { effectiveTo: { gte: now } },
                    ],
                },
            };
        }

        const [ employees, total ] = await Promise.all([
            prisma.employee.findMany({
                where,
                select: {
                    ...prismaSelectDefault.employee,
                    startDate: true,
                    workLeader: {
                        select: {
                            id: true,
                            name: true,
                            branch: {
                                select: prismaSelectDefault.branch,
                            }
                        }
                    },
                    // ดึง position และ employeeType จาก wageRate ที่ active
                    wageRates: {
                        where: {
                            effectiveFrom: { lte: now },
                            OR: [
                                { effectiveTo: null },
                                { effectiveTo: { gte: now } },
                            ],
                        },
                        select: {
                            position: {
                                select: {
                                    id: true,
                                    name: true,
                                    employeeType: true,
                                },
                            },
                        },
                        take: 1,
                        orderBy: { effectiveFrom: 'desc' },
                    },
                },
                skip: (page - 1) * limit,
                take: limit,
                orderBy: {
                    [sortBy]: sort,
                },
            }),
            prisma.employee.count({
                where,
            }),
        ]);

        // Transform: flatten position from wageRates (employeeType อยู่ใน position)
        const transformedEmployees = employees.map(emp => this._transformEmployee(emp));

        return {
            data: transformedEmployees,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        };
    }

    /**
     * สร้างพนักงานใหม่
     * @param {EmployeeCreateData} params - ข้อมูลพนักงานใหม่
     * @returns {Promise<Employee>} ข้อมูลพนักงานที่สร้างใหม่
     */
    async createEmployee({ firstName, lastName, idCard, phone, bankAccount, shiftType, workLeaderId, startDate }) {
        const employee = await prisma.employee.create({
            data: {
                firstName,
                lastName,
                idCard,
                phone,
                bankAccount,
                shiftType,
                workLeaderId,
                startDate: new Date(startDate),
            },
            select: {
                ...prismaSelectDefault.employee,
                bankAccount: true,
                startDate: true,
                createdAt: true,
                updatedAt: true,
                workLeader: {
                    select: {
                        id: true,
                        name: true,
                        branch: {
                            select: prismaSelectDefault.branch,
                        }
                    }
                },
            },
        });

        return this._transformEmployee(employee);
    }

    /**
     * ดึงข้อมูลพนักงานตาม ID
     * @param {Object} params - Parameters
     * @param {string} params.id - Employee ID (UUID)
     * @returns {Promise<Employee>} ข้อมูลพนักงาน
     * @throws {AppError} ไม่พบพนักงาน (notFound)
     */
    async getEmployeeById({ id }) {
        const employee = await prisma.employee.findUnique({
            where: { id },
            select: {
                ...prismaSelectDefault.employee,
                idCard: true,
                bankAccount: true,
                startDate: true,
                createdAt: true,
                updatedAt: true,
                workLeader: {
                    select: {
                        id: true,
                        name: true,
                        branch: {
                            select: prismaSelectDefault.branch,
                        }
                    }
                },
                // ดึง position และ employeeType จาก wageRate ที่ active
                wageRates: {
                    where: {
                        effectiveFrom: { lte: new Date() },
                        OR: [
                            { effectiveTo: null },
                            { effectiveTo: { gte: new Date() } },
                        ],
                    },
                    select: {
                        position: {
                            select: {
                                id: true,
                                name: true,
                                employeeType: true,
                            },
                        },
                    },
                    take: 1,
                    orderBy: { effectiveFrom: 'desc' },
                },
            },
        });

        if (!employee) {
            throw err.notFound({ id });
        }

        return this._transformEmployee(employee);
    }

    /**
     * อัปเดตข้อมูลพนักงาน
     * @param {string} id - Employee ID (UUID)
     * @param {EmployeeUpdateData} params - ข้อมูลที่จะอัปเดต
     * @returns {Promise<Employee>} ข้อมูลพนักงานที่อัปเดตแล้ว
     * @throws {AppError} ไม่พบพนักงาน (notFound)
     */
    async updateEmployee(id, { firstName, lastName, idCard, phone, bankAccount, shiftType, workLeaderId, startDate, isActive }) {
        // ตรวจสอบว่ามี employee อยู่จริง
        const employee = await prisma.employee.findUnique({
            where: { id },
            select: { id: true }, // เช็คเฉพาะ id เพื่อประหยัด resource
        });

        if (!employee) {
            throw err.notFound({ id });
        }

        // อัปเดตเฉพาะฟิลด์ที่ส่งมา และ select เฉพาะฟิลด์ที่ต้องการคืนค่า
        const updated = await prisma.employee.update({
            where: { id },
            data: {
                ...(firstName !== undefined && { firstName }),
                ...(lastName !== undefined && { lastName }),
                ...(idCard !== undefined && { idCard }),
                ...(phone !== undefined && { phone }),
                ...(bankAccount !== undefined && { bankAccount }),
                ...(shiftType !== undefined && { shiftType }),
                ...(workLeaderId !== undefined && { workLeaderId }),
                ...(startDate !== undefined && { startDate }),
                ...(isActive !== undefined && { isActive }),
            },
            select: {
                ...prismaSelectDefault.employee,
                idCard: true,
                bankAccount: true,
                startDate: true,
                createdAt: true,
                updatedAt: true,
                workLeader: {
                    select: {
                        id: true,
                        name: true,
                        branch: {
                            select: prismaSelectDefault.branch,
                        }
                    }
                },
                // ดึง position และ employeeType จาก wageRate ที่ active
                wageRates: {
                    where: {
                        effectiveFrom: { lte: new Date() },
                        OR: [
                            { effectiveTo: null },
                            { effectiveTo: { gte: new Date() } },
                        ],
                    },
                    select: {
                        position: {
                            select: {
                                id: true,
                                name: true,
                                employeeType: true,
                            },
                        },
                    },
                    take: 1,
                    orderBy: { effectiveFrom: 'desc' },
                },
            },
        });

        return this._transformEmployee(updated);
    }

    /**
     * ดึงประวัติค่าแรงของพนักงาน
     * @param {Object} params - Query parameters
     * @param {string} params.employeeId - Employee ID (UUID)
     * @param {number} params.page - หน้าปัจจุบัน
     * @param {number} params.limit - จำนวนรายการต่อหน้า
     * @param {'asc'|'desc'} params.sort - ทิศทางการเรียงลำดับ
     * @param {string} params.sortBy - ฟิลด์ที่ใช้เรียงลำดับ
     * @returns {Promise<PaginationResult>} รายการประวัติค่าแรงพร้อม pagination
     * @throws {AppError} ไม่พบพนักงาน (notFound)
     */
    async getWagesByEmployeeId({ employeeId, page, limit, sort, sortBy }) {
        // ตรวจสอบว่า employee มีอยู่จริง
        const employee = await prisma.employee.findUnique({
            where: { id: employeeId },
            select: { id: true },
        });

        if (!employee) {
            throw err.notFound({ employeeId });
        }

        const where = { employeeId };

        const [wages, total] = await Promise.all([
            prisma.wageRate.findMany({
                where,
                select: {
                    ...prismaSelectDefault.wageRate,
                    position: {
                        select: {
                            id: true,
                            name: true,
                            employeeType: true,
                        }
                    }
                },
                skip: (page - 1) * limit,
                take: limit,
                orderBy: {
                    [sortBy]: sort,
                },
            }),
            prisma.wageRate.count({ where }),
        ]);

        return {
            data: wages,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        };
    }

    /**
     * สร้างประวัติค่าแรงใหม่สำหรับพนักงาน
     * @param {WageCreateData} params - ข้อมูลค่าแรงใหม่
     * @returns {Promise<WageRate>} ข้อมูลค่าแรงที่สร้างใหม่
     * @throws {AppError} ไม่พบพนักงาน (notFound) หรือ ไม่พบตำแหน่งงาน (validation)
     */
    async createWage({ employeeId, positionId, dailyRate, hourlyRate, minuteRate, monthlyRate, effectiveFrom, effectiveTo, note }) {
        // ตรวจสอบ employee มีอยู่จริง
        const employee = await prisma.employee.findUnique({
            where: { id: employeeId },
            select: { id: true },
        });

        if (!employee) {
            throw err.notFound({ employeeId });
        }

        // ตรวจสอบ positionId มีอยู่จริง
        await this._validatePositionExists(positionId);

        const wage = await prisma.wageRate.create({
            data: {
                employeeId,
                positionId,
                dailyRate,
                hourlyRate,
                minuteRate,
                monthlyRate,
                effectiveFrom: new Date(effectiveFrom),
                effectiveTo: effectiveTo ? new Date(effectiveTo) : null,
                note,
            },
            select: {
                ...prismaSelectDefault.wageRate,
                position: {
                    select: {
                        name: true,
                        employeeType: true,
                    }
                }
            },
        });

        return wage;
    }

    /**
     * ดึงข้อมูลการลงเวลาของพนักงานตามช่วงวันที่
     * @param {Object} params - Parameters
     * @param {number} params.employeeId - Employee ID
     * @param {string} params.startDate - วันที่เริ่มต้น (YYYY-MM-DD)
     * @param {string} params.endDate - วันที่สิ้นสุด (YYYY-MM-DD)
     * @returns {Promise<{data: Array, summary: Object}>} ข้อมูลการลงเวลาและสรุป
     * @throws {AppError} ไม่พบพนักงาน (notFound)
     */
    async getTimeEntries({ employeeId, startDate, endDate }) {
        const startOfDay = combineDateAndTime(startDate, '00:00:00');
        const endOfDay = combineDateAndTime(endDate, '23:59:59');
        const timeEntries = await prisma.timeEntry.findMany({
            where: {
                employeeId,
                startTime: {
                    gte: startOfDay,
                    lte: endOfDay,
                },
                workType: {
                    in: ['REGULAR', 'OVERTIME', 'ACCOMMODATION'],
                },
                isNegative: false,
            },
            select: {
                startTime: true,
                endTime: true,
                workType: true,
                shiftType: true,
                otRate: true,
                accommodation: true,
                paidValue: true,
            },
            orderBy: {
                startTime: 'asc',
            },
        });

        // Pre-fill all dates in the range
        const groupedByDate = {};
        const currentDate = combineDateAndTime(startDate, '00:00:00');
        const lastDate = combineDateAndTime(endDate, '00:00:00');
        while (currentDate <= lastDate) {
            const dateKey = toLocalDate(currentDate);
            groupedByDate[dateKey] = { date: dateKey, regular: [], ot: [], accommodation: [] };
            currentDate.setDate(currentDate.getDate() + 1);
        }

        // Group entries by date
        for (const entry of timeEntries) {
            const dateKey = toLocalDate(entry.startTime);

            const timeRangeStart = toLocalTime(entry.startTime);

            let timeRangeEnd = '';
            let totalMinutes = 0;

            if (entry.endTime) {
                timeRangeEnd = toLocalTime(entry.endTime);
                totalMinutes = Math.round(
                    (entry.endTime.getTime() - entry.startTime.getTime()) / (1000 * 60),
                );
            }

            const timeRange = `${timeRangeStart} - ${timeRangeEnd}`;

            if (entry.workType === 'REGULAR') {
                // หากเป็น REGULAR shift ต้องหักเวลาพักเที่ยง 12:00-13:00 (60 นาที)
                // หากช่วงเวลาทำงานคร่อมช่วงพักเที่ยง
                let effectiveMinutes = totalMinutes;
                if (entry.shiftType === 'REGULAR' && entry.endTime) {
                    const lunchStart = 12 * 60; // 12:00 = 720 นาที
                    const lunchEnd = 13 * 60;   // 13:00 = 780 นาที
                    const startMinutes = entry.startTime.getHours() * 60 + entry.startTime.getMinutes();
                    const endMinutes = entry.endTime.getHours() * 60 + entry.endTime.getMinutes();
                    const overlapStart = Math.max(startMinutes, lunchStart);
                    const overlapEnd = Math.min(endMinutes, lunchEnd);
                    if (overlapStart < overlapEnd) {
                        effectiveMinutes -= (overlapEnd - overlapStart);
                    }
                }
                const days = Math.floor((effectiveMinutes / 480) * 100) / 100;
                groupedByDate[dateKey].regular.push({
                    startTime: entry.startTime,
                    endTime: entry.endTime,
                    timeRange,
                    days,
                    totalMinutes: effectiveMinutes,
                    paidValue: entry.paidValue,
                });
            } else if (entry.workType === 'OVERTIME') {
                const rate = entry.otRate ? Number(entry.otRate) : 1;
                groupedByDate[dateKey].ot.push({
                    startTime: entry.startTime,
                    endTime: entry.endTime,
                    timeRange,
                    duration: formatMinutesToHours(totalMinutes),
                    totalMinutes,
                    rate,
                    paidValue: entry.paidValue,
                });
            } else if (entry.workType === 'ACCOMMODATION') {
                groupedByDate[dateKey].accommodation.push({
                    accommodation: Number(entry.accommodation),
                    paidValue: entry.paidValue,
                });
            }
        }

        // Sort days ascending by date
        const data = Object.values(groupedByDate).sort((a, b) => a.date.localeCompare(b.date));

        // Calculate summary
        let totalDays = 0;
        let totalOtMinutes = 0;
        const totalOtByRate = {};

        for (const day of data) {
            for (const regular of day.regular) {
                totalDays += regular.days;
            }

            for (const ot of day.ot) {
                totalOtMinutes += ot.totalMinutes;

                const rateKey = String(ot.rate);
                if (!totalOtByRate[rateKey]) {
                    totalOtByRate[rateKey] = 0;
                }
                totalOtByRate[rateKey] += ot.totalMinutes;
            }
        }

        let totalAccommodation = 0;
        for (const day of data) {
            totalAccommodation += day.accommodation.length;
        }

        const formattedOtByRate = {};
        for (const rate of Object.keys(totalOtByRate)) {
            formattedOtByRate[rate] = formatMinutesToHours(totalOtByRate[rate]);
        }

        const summary = {
            totalDays: Math.floor(totalDays * 100) / 100,
            totalOtHours: formatMinutesToHours(totalOtMinutes),
            totalOtByRate: formattedOtByRate,
            totalAccommodation,
        };

        // Remove internal totalMinutes from response
        const cleanData = data.map((day) => ({
            date: day.date,
            regular: day.regular.map(({ startTime, endTime, timeRange, days, paidValue }) => ({ startTime, endTime, timeRange, days, paidValue })),
            ot: day.ot.map(({ startTime, endTime, timeRange, duration, rate, paidValue }) => ({ startTime, endTime, timeRange, duration, rate, paidValue })),
            accommodation: day.accommodation.map(({ accommodation, paidValue }) => ({ accommodation, paidValue })),
        }));

        return { data: cleanData, summary };
    }

    /**
     * อัปเดตข้อมูลค่าแรง
     * @param {string} wageId - WageRate ID (UUID)
     * @param {string} employeeId - Employee ID (UUID) - ตรวจสอบว่า wage เป็นของพนักงานคนนี้
     * @param {WageUpdateData} params - ข้อมูลที่จะอัปเดต
     * @returns {Promise<WageRate>} ข้อมูลค่าแรงที่อัปเดตแล้ว
     * @throws {AppError} ไม่พบค่าแรง (notFound) หรือ ค่าแรงไม่ใช่ของพนักงานคนนี้ (notFound) หรือ ไม่พบตำแหน่งงาน (validation) หรือ วันที่สิ้นสุดต้องมากกว่าวันที่เริ่มต้น (validation)
     */
    async updateWage(wageId, employeeId, { positionId, dailyRate, hourlyRate, minuteRate, monthlyRate, effectiveFrom, effectiveTo, note }) {
        // ตรวจสอบ wage มีอยู่จริงและเป็นของ employee คนนี้
        const wage = await prisma.wageRate.findUnique({
            where: { id: wageId },
            select: { id: true, employeeId: true },
        });

        if (!wage) {
            throw err.notFound({ wageId });
        }

        if (wage.employeeId !== employeeId) {
            throw err.notFound({ wageId: 'ไม่พบค่าแรงของพนักงานคนนี้' });
        }

        // ถ้ามี positionId ให้ตรวจสอบว่า position มีอยู่จริง
        if (positionId !== undefined) {
            await this._validatePositionExists(positionId);
        }

        // ตรวจสอบ effectiveTo > effectiveFrom
        const finalEffectiveFrom = effectiveFrom !== undefined ? new Date(effectiveFrom) : undefined;
        const finalEffectiveTo = effectiveTo !== undefined ? (effectiveTo ? new Date(effectiveTo) : null) : undefined;

        if (finalEffectiveTo && finalEffectiveFrom && finalEffectiveTo <= finalEffectiveFrom) {
            throw err.validation({ effectiveTo: 'วันที่สิ้นสุดต้องมากกว่าวันที่เริ่มต้น' });
        }

        const updated = await prisma.wageRate.update({
            where: { id: wageId },
            data: {
                ...(positionId !== undefined && { positionId }),
                ...(dailyRate !== undefined && { dailyRate }),
                ...(hourlyRate !== undefined && { hourlyRate }),
                ...(minuteRate !== undefined && { minuteRate }),
                ...(monthlyRate !== undefined && { monthlyRate }),
                ...(finalEffectiveFrom !== undefined && { effectiveFrom: finalEffectiveFrom }),
                ...(finalEffectiveTo !== undefined && { effectiveTo: finalEffectiveTo }),
                ...(note !== undefined && { note }),
            },
            select: {
                ...prismaSelectDefault.wageRate,
                position: {
                    select: {
                        name: true,
                        employeeType: true,
                    }
                }
            },
        });

        return updated;
    }
}

export default new EmployeeService();

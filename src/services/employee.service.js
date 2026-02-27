import prisma from "../databases/prisma.js";
import err from "../utils/error.js";
import prismaSelectDefault from "../utils/prismaSelectDefault.js";

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
 * @property {string} employeeType - ประเภทพนักงาน (GENERAL, DRIVER, AGENT, ACCOUNTANT)
 * @property {string} shiftType - ประเภทการทำงาน (REGULAR, SHIFT)
 * @property {string} positionId - ID ของตำแหน่งงาน
 * @property {Object} position - ข้อมูลตำแหน่งงาน
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
 * @property {string} employeeType - ประเภทพนักงาน
 * @property {string} shiftType - ประเภทการทำงาน
 * @property {string} positionId - ID ของตำแหน่งงาน
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
 * @property {string} [employeeType] - ประเภทพนักงาน
 * @property {string} [shiftType] - ประเภทการทำงาน
 * @property {string} [positionId] - ID ของตำแหน่งงาน
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
     * @returns {Promise<PaginationResult>} รายการพนักงานพร้อม pagination
     */
    async getEmployees({ page, limit, sort, sortBy, ...query }) {
        const where = {};

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

        const [ employees, total ] = await Promise.all([
            prisma.employee.findMany({
                where,
                select: {
                    ...prismaSelectDefault.employee,
                    workLeader: {
                        select: {
                            id: true,
                            name: true,
                            branch: {
                                select: prismaSelectDefault.branch,
                            }
                        }
                    }
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

        return {
            data: employees,
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
    async createEmployee({ firstName, lastName, idCard, phone, bankAccount, employeeType, shiftType, positionId, workLeaderId, startDate }) {
        const employee = await prisma.employee.create({
            data: {
                firstName,
                lastName,
                idCard,
                phone,
                bankAccount,
                employeeType,
                shiftType,
                positionId,
                workLeaderId,
                startDate: new Date(startDate),
            },
            select: {
                ...prismaSelectDefault.employee,
                bankAccount: true,
                startDate: true,
                createdAt: true,
                updatedAt: true,
                position: {
                    select: prismaSelectDefault.position,
                },
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
        return employee;
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
                position: {
                    select: prismaSelectDefault.position,
                },
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

        if (!employee) {
            throw err.notFound({ id });
        }

        return employee;
    }

    /**
     * อัปเดตข้อมูลพนักงาน
     * @param {string} id - Employee ID (UUID)
     * @param {EmployeeUpdateData} params - ข้อมูลที่จะอัปเดต
     * @returns {Promise<Employee>} ข้อมูลพนักงานที่อัปเดตแล้ว
     * @throws {AppError} ไม่พบพนักงาน (notFound)
     */
    async updateEmployee(id, { firstName, lastName, idCard, phone, bankAccount, employeeType, shiftType, positionId, workLeaderId, startDate, isActive }) {
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
                ...(employeeType !== undefined && { employeeType }),
                ...(shiftType !== undefined && { shiftType }),
                ...(positionId !== undefined && { positionId }),
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
                position: {
                    select: prismaSelectDefault.position,
                },
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

        return updated;
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

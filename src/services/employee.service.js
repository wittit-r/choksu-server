import { Op } from "sequelize";

import { Employee, WageRate, Position, TimeEntry } from "../database/index.js";
import err from "../utils/error.js";
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
        const position = await Position.findByPk(positionId, {
            attributes: ["id"],
        });

        if (!position) {
            throw err.validation({ positionId: "ไม่พบตำแหน่งงาน" });
        }

        return position;
    }

    /**
     * ดึง WageRate พร้อมข้อมูลตำแหน่งงาน (shape เดิมของ select: position มีแค่ name, employeeType —
     * Sequelize เติม primary key ของ include ให้เอง จึงต้องเลือก field เอง)
     * @private
     * @param {number} wageId - WageRate ID
     * @returns {Promise<Object>} WageRate (plain) พร้อม position
     */
    async _getWageWithPosition(wageId) {
        const wage = await WageRate.findByPk(wageId, {
            attributes: ["id", "dailyRate", "hourlyRate", "minuteRate", "monthlyRate", "effectiveFrom", "effectiveTo", "note"],
            include: {
                association: "position",
                attributes: ["name", "employeeType"],
            },
        });
        const plain = wage.toJSON();
        plain.position = {
            name: plain.position.name,
            employeeType: plain.position.employeeType,
        };
        return plain;
    }

    /**
     * ดึง WageRate ที่ active ณ ตอนนี้ อันแรก (effectiveFrom ล่าสุด) ของแต่ละ employee
     * ทดแทน Prisma include wageRates { take: 1, orderBy: effectiveFrom desc }
     * (Sequelize ทำ per-parent limit ใน include ไม่ได้ → query แยกแล้วเลือกอันแรกใน JS)
     * @private
     * @param {number[]} employeeIds - รายการ Employee ID
     * @returns {Promise<Map<number, Object>>} Map employeeId → WageRate (plain object มี position)
     */
    async _getLatestActiveWageRates(employeeIds) {
        const latestByEmployee = new Map();
        if (!employeeIds || employeeIds.length === 0) {
            return latestByEmployee;
        }

        const now = new Date();
        const wageRates = await WageRate.findAll({
            where: {
                employeeId: { [Op.in]: employeeIds },
                effectiveFrom: { [Op.lte]: now },
                [Op.or]: [{ effectiveTo: null }, { effectiveTo: { [Op.gte]: now } }],
            },
            attributes: ["id", "employeeId", "positionId", "dailyRate", "effectiveFrom"],
            include: {
                association: "position",
                attributes: ["id", "name", "employeeType"],
            },
            order: [["effectiveFrom", "DESC"]],
        });

        for (const wageRate of wageRates) {
            if (!latestByEmployee.has(wageRate.employeeId)) {
                latestByEmployee.set(wageRate.employeeId, wageRate.toJSON());
            }
        }

        return latestByEmployee;
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
        const activeWageWindow = {
            effectiveFrom: { [Op.lte]: now },
            [Op.or]: [{ effectiveTo: null }, { effectiveTo: { [Op.gte]: now } }],
        };

        if (query.search) {
            // collation ของ MySQL ไม่สน case อยู่แล้ว (แทน contains insensitive)
            where[Op.or] = [{ firstName: { [Op.like]: `%${query.search}%` } }, { lastName: { [Op.like]: `%${query.search}%` } }, { idCard: query.search }, { phone: query.search }];
        }

        if (query.isActive !== undefined) {
            where.isActive = query.isActive;
        }

        if (query.workLeaderId !== undefined) {
            where.workLeaderId = query.workLeaderId;
        }

        // กรอง branchId ผ่าน relation workLeader (แทน Prisma where.workLeader = { branchId })
        const workLeaderInclude = {
            association: "workLeader",
            attributes: ["id", "name"],
            include: {
                association: "branch",
                attributes: ["id", "name", "fullname"],
            },
        };
        if (query.branchId !== undefined) {
            workLeaderInclude.where = { branchId: query.branchId };
            workLeaderInclude.required = true;
        }

        // Filter by position (จาก WageRate ที่ active) / employeeType (จาก Position ผ่าน WageRate ที่ active)
        // ทดแทน where.wageRates = { some: {...} } ด้วย required include + where
        // (INNER JOIN ที่มี where ใน ON = เงื่อนไข some ของ Prisma)
        // หมายเหตุ: ห้ามใช้ where key '$wageRates.positionId$' ระดับบนสุด — Sequelize ไม่แปลง
        // ชื่อ attribute เป็นชื่อคอลัมน์ (underscored) ในกรณีนี้ ทำให้เกิด Unknown column
        // และห้ามใช้ nested include (position) ที่มี where ร่วมกับ subQuery pagination —
        // Sequelize จะสร้าง join ซ้ำที่อ้าง alias ผิด (Unknown column 'wageRates.position_id')
        // → employeeType จึงแปลงเป็นการดึง position ids ก่อนแล้วกรอง positionId IN (...)
        // (คง behavior เดิม: ถ้าส่ง positionId และ employeeType พร้อมกัน filter ของ employeeType จะ override)
        let wageFilterInclude = null;
        if (query.positionId !== undefined) {
            wageFilterInclude = {
                association: "wageRates",
                attributes: [],
                required: true,
                where: { positionId: query.positionId, ...activeWageWindow },
            };
        }
        if (query.employeeType !== undefined) {
            const positions = await Position.findAll({
                where: { employeeType: query.employeeType },
                attributes: ["id"],
            });
            wageFilterInclude = {
                association: "wageRates",
                attributes: [],
                required: true,
                where: {
                    positionId: { [Op.in]: positions.map((position) => position.id) },
                    ...activeWageWindow,
                },
            };
        }

        const include = [workLeaderInclude];
        if (wageFilterInclude) {
            include.push(wageFilterInclude);
        }

        const { rows: employees, count: total } = await Employee.findAndCountAll({
            where,
            attributes: ["id", "firstName", "lastName", "phone", "shiftType", "isActive", "startDate"],
            include,
            distinct: true,
            offset: (page - 1) * limit,
            limit,
            order: [[sortBy, sort]],
        });

        // ดึง position และ employeeType จาก wageRate ที่ active (ล่าสุด) แยกต่างหาก
        const latestWageRates = await this._getLatestActiveWageRates(employees.map((emp) => emp.id));

        // Transform: flatten position from wageRates (employeeType อยู่ใน position)
        const transformedEmployees = employees.map((emp) => {
            const plain = emp.toJSON();
            plain.wageRates = latestWageRates.has(emp.id) ? [latestWageRates.get(emp.id)] : [];
            return this._transformEmployee(plain);
        });

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
        // ตรวจสอบ idCard ซ้ำก่อนสร้าง (unique index → 409 แทน 500)
        const existing = await Employee.findOne({ where: { idCard }, attributes: ["id"] });
        if (existing) throw err.conflict({ idCard }, "เลขบัตรประชาชนนี้ถูกใช้งานแล้ว");

        const created = await Employee.create({
            firstName,
            lastName,
            idCard,
            phone,
            bankAccount,
            shiftType,
            workLeaderId,
            startDate: new Date(startDate),
        });

        const employee = await Employee.findByPk(created.id, {
            attributes: ["id", "firstName", "lastName", "phone", "shiftType", "isActive", "bankAccount", "startDate", "createdAt", "updatedAt"],
            include: {
                association: "workLeader",
                attributes: ["id", "name"],
                include: {
                    association: "branch",
                    attributes: ["id", "name", "fullname"],
                },
            },
        });

        return this._transformEmployee(employee.toJSON());
    }

    /**
     * ดึงข้อมูลพนักงานตาม ID
     * @param {Object} params - Parameters
     * @param {string} params.id - Employee ID (UUID)
     * @returns {Promise<Employee>} ข้อมูลพนักงาน
     * @throws {AppError} ไม่พบพนักงาน (notFound)
     */
    async getEmployeeById({ id }) {
        const employee = await Employee.findByPk(id, {
            attributes: ["id", "firstName", "lastName", "phone", "shiftType", "isActive", "idCard", "bankAccount", "startDate", "createdAt", "updatedAt"],
            include: {
                association: "workLeader",
                attributes: ["id", "name"],
                include: {
                    association: "branch",
                    attributes: ["id", "name", "fullname"],
                },
            },
        });

        if (!employee) {
            throw err.notFound({ id });
        }

        // ดึง position และ employeeType จาก wageRate ที่ active (ล่าสุด)
        const latestWageRates = await this._getLatestActiveWageRates([id]);
        const plain = employee.toJSON();
        plain.wageRates = latestWageRates.has(id) ? [latestWageRates.get(id)] : [];

        return this._transformEmployee(plain);
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
        const employee = await Employee.findByPk(id, {
            attributes: ["id"], // เช็คเฉพาะ id เพื่อประหยัด resource
        });

        if (!employee) {
            throw err.notFound({ id });
        }

        // ตรวจสอบ idCard ซ้ำ (ไม่รวมตัวเอง)
        if (idCard !== undefined) {
            const existing = await Employee.findOne({
                where: { idCard, id: { [Op.ne]: id } },
                attributes: ["id"],
            });
            if (existing) throw err.conflict({ idCard }, "เลขบัตรประชาชนนี้ถูกใช้งานแล้ว");
        }

        // อัปเดตเฉพาะฟิลด์ที่ส่งมา
        await Employee.update(
            {
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
            { where: { id } },
        );

        const updated = await Employee.findByPk(id, {
            attributes: ["id", "firstName", "lastName", "phone", "shiftType", "isActive", "idCard", "bankAccount", "startDate", "createdAt", "updatedAt"],
            include: {
                association: "workLeader",
                attributes: ["id", "name"],
                include: {
                    association: "branch",
                    attributes: ["id", "name", "fullname"],
                },
            },
        });

        // ดึง position และ employeeType จาก wageRate ที่ active (ล่าสุด)
        const latestWageRates = await this._getLatestActiveWageRates([id]);
        const plain = updated.toJSON();
        plain.wageRates = latestWageRates.has(id) ? [latestWageRates.get(id)] : [];

        return this._transformEmployee(plain);
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
        const employee = await Employee.findByPk(employeeId, {
            attributes: ["id"],
        });

        if (!employee) {
            throw err.notFound({ employeeId });
        }

        const where = { employeeId };

        const { rows: wages, count: total } = await WageRate.findAndCountAll({
            where,
            attributes: ["id", "dailyRate", "hourlyRate", "minuteRate", "monthlyRate", "effectiveFrom", "effectiveTo", "note"],
            include: {
                association: "position",
                attributes: ["id", "name", "employeeType"],
            },
            offset: (page - 1) * limit,
            limit,
            order: [[sortBy, sort]],
        });

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
        const employee = await Employee.findByPk(employeeId, {
            attributes: ["id"],
        });

        if (!employee) {
            throw err.notFound({ employeeId });
        }

        // ตรวจสอบ positionId มีอยู่จริง
        await this._validatePositionExists(positionId);

        // ตรวจสอบช่วงวันที่ (เดียวกับ updateWage)
        if (effectiveTo && new Date(effectiveTo) <= new Date(effectiveFrom)) {
            throw err.validation({ effectiveFrom, effectiveTo }, "วันที่สิ้นสุดต้องมากกว่าวันที่เริ่มต้น");
        }

        const wage = await WageRate.create({
            employeeId,
            positionId,
            dailyRate,
            hourlyRate,
            minuteRate,
            monthlyRate,
            effectiveFrom: new Date(effectiveFrom),
            effectiveTo: effectiveTo ? new Date(effectiveTo) : null,
            note,
        });

        return this._getWageWithPosition(wage.id);
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
        const startOfDay = combineDateAndTime(startDate, "00:00:00");
        const endOfDay = combineDateAndTime(endDate, "23:59:59");
        const timeEntries = await TimeEntry.findAll({
            where: {
                employeeId,
                startTime: {
                    [Op.gte]: startOfDay,
                    [Op.lte]: endOfDay,
                },
                workType: {
                    [Op.in]: ["REGULAR", "OVERTIME", "ACCOMMODATION"],
                },
            },
            attributes: ["id", "startTime", "endTime", "workType", "shiftType", "otRate", "accommodation", "paidValue", "paidDate", "isNegative", "isRetro", "referenceEntryId"],
            order: [["startTime", "ASC"]],
        });

        // Pre-fill all dates in the range
        const groupedByDate = {};
        const currentDate = combineDateAndTime(startDate, "00:00:00");
        const lastDate = combineDateAndTime(endDate, "00:00:00");
        while (currentDate <= lastDate) {
            const dateKey = toLocalDate(currentDate);
            groupedByDate[dateKey] = {
                date: dateKey,
                regular: [],
                ot: [],
                accommodation: [],
            };
            currentDate.setDate(currentDate.getDate() + 1);
        }

        // Separate normal and related (negative/retro) entries
        const normalEntries = timeEntries.filter((e) => !e.isNegative && !e.isRetro);
        const relatedEntries = timeEntries.filter((e) => e.isNegative || e.isRetro);

        // Map for lookup: normal entry id -> { dateKey, workType, timeRange }
        const entryMap = new Map();

        // Helper: build timeRange string from start/end times
        const buildTimeRange = (startTime, endTime) => {
            const start = toLocalTime(startTime);
            const end = endTime ? toLocalTime(endTime) : "";
            return `${start} - ${end}`;
        };

        // Helper: get bucket key from workType
        const workTypeBucket = (workType) => {
            if (workType === "REGULAR") return "regular";
            if (workType === "OVERTIME") return "ot";
            return "accommodation";
        };

        // Group normal entries
        for (const entry of normalEntries) {
            const dateKey = toLocalDate(entry.startTime);
            const timeRange = buildTimeRange(entry.startTime, entry.endTime);

            let totalMinutes = 0;
            if (entry.endTime) {
                totalMinutes = Math.round((entry.endTime.getTime() - entry.startTime.getTime()) / (1000 * 60));
            }

            if (entry.workType === "REGULAR") {
                let effectiveMinutes = totalMinutes;
                if (entry.shiftType === "REGULAR" && entry.endTime) {
                    const lunchStart = 12 * 60;
                    const lunchEnd = 13 * 60;
                    const startMinutes = entry.startTime.getHours() * 60 + entry.startTime.getMinutes();
                    const endMinutes = entry.endTime.getHours() * 60 + entry.endTime.getMinutes();
                    const overlapStart = Math.max(startMinutes, lunchStart);
                    const overlapEnd = Math.min(endMinutes, lunchEnd);
                    if (overlapStart < overlapEnd) {
                        effectiveMinutes -= overlapEnd - overlapStart;
                    }
                }
                const days = Math.floor((effectiveMinutes / 480) * 100) / 100;
                groupedByDate[dateKey].regular.push({
                    id: entry.id,
                    startTime: entry.startTime,
                    endTime: entry.endTime,
                    timeRange,
                    days,
                    totalMinutes: effectiveMinutes,
                    paidValue: entry.paidValue,
                    paidDate: entry.paidDate,
                    isNegative: false,
                    isRetro: false,
                    referenceEntryId: null,
                });
            } else if (entry.workType === "OVERTIME") {
                const rate = entry.otRate ? Number(entry.otRate) : 1;
                groupedByDate[dateKey].ot.push({
                    id: entry.id,
                    startTime: entry.startTime,
                    endTime: entry.endTime,
                    timeRange,
                    duration: formatMinutesToHours(totalMinutes),
                    totalMinutes,
                    rate,
                    paidValue: entry.paidValue,
                    paidDate: entry.paidDate,
                    isNegative: false,
                    isRetro: false,
                    referenceEntryId: null,
                });
            } else if (entry.workType === "ACCOMMODATION") {
                groupedByDate[dateKey].accommodation.push({
                    id: entry.id,
                    accommodation: Number(entry.accommodation),
                    paidValue: entry.paidValue,
                    paidDate: entry.paidDate,
                    isNegative: false,
                    isRetro: false,
                    referenceEntryId: null,
                });
            }

            entryMap.set(entry.id, { dateKey, workType: entry.workType, timeRange });
        }

        // Attach negative/retro entries to their referenced normal entries
        for (const entry of relatedEntries) {
            const ref = entryMap.get(entry.referenceEntryId);
            if (!ref) continue; // reference entry not in this date range, skip

            const bucket = groupedByDate[ref.dateKey][workTypeBucket(ref.workType)];
            if (!bucket) continue;

            if (entry.isNegative) {
                // Negative: use own time, calculate normally
                const timeRange = buildTimeRange(entry.startTime, entry.endTime);
                let totalMinutes = 0;
                if (entry.endTime) {
                    totalMinutes = Math.round((entry.endTime.getTime() - entry.startTime.getTime()) / (1000 * 60));
                }

                if (entry.workType === "REGULAR") {
                    let effectiveMinutes = totalMinutes;
                    if (entry.shiftType === "REGULAR" && entry.endTime) {
                        const lunchStart = 12 * 60;
                        const lunchEnd = 13 * 60;
                        const startMinutes = entry.startTime.getHours() * 60 + entry.startTime.getMinutes();
                        const endMinutes = entry.endTime.getHours() * 60 + entry.endTime.getMinutes();
                        const overlapStart = Math.max(startMinutes, lunchStart);
                        const overlapEnd = Math.min(endMinutes, lunchEnd);
                        if (overlapStart < overlapEnd) {
                            effectiveMinutes -= overlapEnd - overlapStart;
                        }
                    }
                    const days = Math.floor((effectiveMinutes / 480) * 100) / 100;
                    bucket.push({
                        id: entry.id,
                        isNegative: true,
                        referenceEntryId: entry.referenceEntryId,
                        timeRange,
                        days,
                        paidValue: entry.paidValue,
                        paidDate: entry.paidDate,
                    });
                } else if (entry.workType === "OVERTIME") {
                    const rate = entry.otRate ? Number(entry.otRate) : 1;
                    bucket.push({
                        id: entry.id,
                        isNegative: true,
                        referenceEntryId: entry.referenceEntryId,
                        timeRange,
                        duration: formatMinutesToHours(totalMinutes),
                        rate,
                        paidValue: entry.paidValue,
                        paidDate: entry.paidDate,
                    });
                } else if (entry.workType === "ACCOMMODATION") {
                    bucket.push({
                        id: entry.id,
                        isNegative: true,
                        referenceEntryId: entry.referenceEntryId,
                        accommodation: Number(entry.accommodation),
                        paidValue: entry.paidValue,
                        paidDate: entry.paidDate,
                    });
                }
            } else if (entry.isRetro) {
                // Retro: use referenced entry's timeRange, days/duration = null
                bucket.push({
                    id: entry.id,
                    isRetro: true,
                    referenceEntryId: entry.referenceEntryId,
                    timeRange: ref.timeRange,
                    paidValue: entry.paidValue,
                    paidDate: entry.paidDate,
                });
            }
        }

        // Sort entries by id within each bucket
        for (const day of Object.values(groupedByDate)) {
            day.regular.sort((a, b) => a.id - b.id);
            day.ot.sort((a, b) => a.id - b.id);
            day.accommodation.sort((a, b) => a.id - b.id);
        }

        // Sort days ascending by date
        const data = Object.values(groupedByDate).sort((a, b) => a.date.localeCompare(b.date));

        // Calculate summary
        let totalDays = 0;
        let totalOtMinutes = 0;
        let totalAccommodation = 0;
        const totalOtByRate = {};

        for (const day of data) {
            for (const regular of day.regular) {
                if (regular.isRetro) continue;
                totalDays += regular.days;
            }

            for (const ot of day.ot) {
                if (ot.isRetro) continue;
                totalOtMinutes += ot.totalMinutes;

                const rateKey = String(ot.rate);
                if (!totalOtByRate[rateKey]) {
                    totalOtByRate[rateKey] = 0;
                }
                totalOtByRate[rateKey] += ot.totalMinutes;
            }

            totalAccommodation += day.accommodation.filter((a) => !a.isRetro).length;
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
            regular: day.regular.map(({ totalMinutes, ...rest }) => rest),
            ot: day.ot.map(({ totalMinutes, ...rest }) => rest),
            accommodation: day.accommodation.map((item) => item),
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
        const wage = await WageRate.findByPk(wageId, {
            attributes: ["id", "employeeId"],
        });

        if (!wage) {
            throw err.notFound({ wageId });
        }

        if (wage.employeeId !== employeeId) {
            throw err.notFound({ wageId: "ไม่พบค่าแรงของพนักงานคนนี้" });
        }

        // ถ้ามี positionId ให้ตรวจสอบว่า position มีอยู่จริง
        if (positionId !== undefined) {
            await this._validatePositionExists(positionId);
        }

        // ตรวจสอบ effectiveTo > effectiveFrom
        const finalEffectiveFrom = effectiveFrom !== undefined ? new Date(effectiveFrom) : undefined;
        const finalEffectiveTo = effectiveTo !== undefined ? (effectiveTo ? new Date(effectiveTo) : null) : undefined;

        if (finalEffectiveTo && finalEffectiveFrom && finalEffectiveTo <= finalEffectiveFrom) {
            throw err.validation({
                effectiveTo: "วันที่สิ้นสุดต้องมากกว่าวันที่เริ่มต้น",
            });
        }

        await WageRate.update(
            {
                ...(positionId !== undefined && { positionId }),
                ...(dailyRate !== undefined && { dailyRate }),
                ...(hourlyRate !== undefined && { hourlyRate }),
                ...(minuteRate !== undefined && { minuteRate }),
                ...(monthlyRate !== undefined && { monthlyRate }),
                ...(finalEffectiveFrom !== undefined && {
                    effectiveFrom: finalEffectiveFrom,
                }),
                ...(finalEffectiveTo !== undefined && {
                    effectiveTo: finalEffectiveTo,
                }),
                ...(note !== undefined && { note }),
            },
            { where: { id: wageId } },
        );

        return this._getWageWithPosition(wageId);
    }

    /**
     * คำนวณยอดจ่ายเพิ่มย้อนหลังจากการเปลี่ยนแปลงอัตราค่าจ้าง
     * สำหรับพนักงานทุกคนที่มีรายการจ่ายในช่วงเวลาที่กำหนด
     * @param {Object} params
     * @param {string} params.startDate - วันที่เริ่มต้น (YYYY-MM-DD)
     * @param {string} params.endDate - วันที่สิ้นสุด (YYYY-MM-DD)
     * @returns {Promise<Array>} รายการพนักงานพร้อมรายละเอียดส่วนต่าง
     */
    async calculateRetroactive({ startDate, endDate }) {
        const startOfDay = combineDateAndTime(startDate, "00:00:00");
        const endOfDay = combineDateAndTime(endDate, "23:59:59");

        // Step 1: ดึง paid entries ทั้งหมดในช่วงเวลา (REGULAR, OVERTIME เท่านั้น)
        const paidEntries = await TimeEntry.findAll({
            where: {
                startTime: { [Op.gte]: startOfDay, [Op.lte]: endOfDay },
                workType: { [Op.in]: ["REGULAR", "OVERTIME"] },
                paidDate: { [Op.not]: null },
                isNegative: false,
                isRetro: false,
            },
            attributes: ["id", "timeSheetId", "employeeId", "startTime", "endTime", "workType", "shiftType", "otRate", "paidValue"],
            order: [["startTime", "ASC"]],
        });
        if (paidEntries.length === 0) {
            return { data: [], summary: { totalEmployees: 0, totalDiff: 0 } };
        }

        // Extract unique employeeIds
        const uniqueEmployeeIds = [...new Set(paidEntries.map((e) => e.employeeId))];

        // Step 2: ดึง employee info + current wage rate สำหรับแต่ละคน
        const employeeRows = await Employee.findAll({
            where: { id: { [Op.in]: uniqueEmployeeIds } },
            attributes: ["id", "firstName", "lastName"],
        });
        const latestWageRates = await this._getLatestActiveWageRates(uniqueEmployeeIds);
        const employees = employeeRows.map((emp) => {
            const plain = emp.toJSON();
            plain.wageRates = latestWageRates.has(emp.id) ? [latestWageRates.get(emp.id)] : [];
            return plain;
        });

        // ดึง negative entries และ retro entries ที่มีอยู่แล้ว (เพื่อเช็คซ้ำ)
        const originalIds = paidEntries.map((e) => e.id);
        const [negativeEntries, existingRetroEntries] = await Promise.all([
            TimeEntry.findAll({
                where: {
                    referenceEntryId: { [Op.in]: originalIds },
                    isNegative: true,
                },
                attributes: ["id", "referenceEntryId", "paidValue", "startTime", "endTime", "workType", "shiftType"],
            }),
            TimeEntry.findAll({
                where: {
                    referenceEntryId: { [Op.in]: originalIds },
                    isRetro: true,
                },
                attributes: ["id", "referenceEntryId"],
            }),
        ]);

        // Map existing retro entries สำหรับเช็คซ้ำ
        const existingRetroMap = new Map(existingRetroEntries.map((r) => [r.referenceEntryId, r.id]));

        // Group negative entries by referenceEntryId
        const negativeByOriginal = new Map();
        for (const neg of negativeEntries) {
            if (!negativeByOriginal.has(neg.referenceEntryId)) {
                negativeByOriginal.set(neg.referenceEntryId, []);
            }
            negativeByOriginal.get(neg.referenceEntryId).push(neg);
        }

        // Group paid entries by employeeId
        const entriesByEmployee = new Map();
        for (const entry of paidEntries) {
            if (!entriesByEmployee.has(entry.employeeId)) {
                entriesByEmployee.set(entry.employeeId, []);
            }
            entriesByEmployee.get(entry.employeeId).push(entry);
        }

        // Map employees for quick lookup
        const employeeMap = new Map(employees.map((e) => [e.id, e]));

        // Step 3: คำนวณสำหรับแต่ละพนักงาน
        const results = [];
        let grandTotalDiff = 0;

        for (const [employeeId, entries] of entriesByEmployee) {
            const employee = employeeMap.get(employeeId);
            if (!employee || employee.wageRates.length === 0) continue;

            const currentWage = employee.wageRates[0];
            const currentDailyRate = Number(currentWage.dailyRate);
            const employeeType = currentWage.position?.employeeType;

            // TODO: รองรับ Driver (monthlyRate) - ต้องมี logic คำนวณแยก
            if (employeeType === "DRIVER") continue;

            const retroEntries = [];

            for (const entry of entries) {
                // เช็คว่ามี retro entry สร้างไปแล้วหรือยัง
                if (existingRetroMap.has(entry.id)) {
                    retroEntries.push({
                        originalEntryId: entry.id,
                        date: toLocalDate(entry.startTime),
                        workType: entry.workType,
                        netMinutes: null,
                        oldPaidTotal: null,
                        newAmount: null,
                        diffAmount: null,
                        retroEntryId: existingRetroMap.get(entry.id),
                        skipped: true,
                    });
                    continue;
                }

                // คำนวณ effective minutes ของ original entry
                let originalMinutes = 0;
                if (entry.endTime) {
                    originalMinutes = Math.round((entry.endTime.getTime() - entry.startTime.getTime()) / (1000 * 60));

                    // หักเวลาพักเที่ยงสำหรับ REGULAR shift
                    if (entry.workType === "REGULAR" && entry.shiftType === "REGULAR") {
                        const lunchStart = 12 * 60;
                        const lunchEnd = 13 * 60;
                        const startMin = entry.startTime.getHours() * 60 + entry.startTime.getMinutes();
                        const endMin = entry.endTime.getHours() * 60 + entry.endTime.getMinutes();
                        const overlapStart = Math.max(startMin, lunchStart);
                        const overlapEnd = Math.min(endMin, lunchEnd);
                        if (overlapStart < overlapEnd) {
                            originalMinutes -= overlapEnd - overlapStart;
                        }
                    }
                }

                // รวม negative entries
                const negatives = negativeByOriginal.get(entry.id) || [];
                let totalNegativeMinutes = 0;
                let totalNegativePaid = 0;

                for (const neg of negatives) {
                    totalNegativePaid += Number(neg.paidValue || 0);

                    if (neg.endTime) {
                        let negMinutes = Math.round((neg.endTime.getTime() - neg.startTime.getTime()) / (1000 * 60));

                        if (neg.workType === "REGULAR" && neg.shiftType === "REGULAR") {
                            const lunchStart = 12 * 60;
                            const lunchEnd = 13 * 60;
                            const startMin = neg.startTime.getHours() * 60 + neg.startTime.getMinutes();
                            const endMin = neg.endTime.getHours() * 60 + neg.endTime.getMinutes();
                            const overlapStart = Math.max(startMin, lunchStart);
                            const overlapEnd = Math.min(endMin, lunchEnd);
                            if (overlapStart < overlapEnd) {
                                negMinutes -= overlapEnd - overlapStart;
                            }
                        }

                        totalNegativeMinutes += negMinutes;
                    }
                }

                const netMinutes = originalMinutes - totalNegativeMinutes;
                const netPaidValue = Number(entry.paidValue) + totalNegativePaid;

                // คำนวณ newAmount ด้วย current rate
                let newAmount = 0;
                if (entry.workType === "REGULAR") {
                    newAmount = netMinutes * (currentDailyRate / 480);
                } else if (entry.workType === "OVERTIME") {
                    const otMultiplier = Number(entry.otRate) || 1;
                    newAmount = netMinutes * (currentDailyRate / 480) * otMultiplier;
                }

                const diffAmount = Math.round((newAmount - netPaidValue) * 100) / 100;

                if (diffAmount > 0) {
                    // สร้าง retro entry
                    const retroEntry = await TimeEntry.create({
                        timeSheetId: entry.timeSheetId,
                        employeeId: entry.employeeId,
                        startTime: entry.startTime,
                        endTime: null,
                        shiftType: entry.shiftType,
                        workType: entry.workType,
                        otRate: entry.workType === "OVERTIME" ? entry.otRate : 0,
                        isRetro: true,
                        referenceEntryId: entry.id,
                        paidValue: diffAmount,
                        note: `จ่ายเพิ่มย้อนหลัง (อ้างอิง entry #${entry.id})`,
                    });

                    retroEntries.push({
                        originalEntryId: entry.id,
                        date: toLocalDate(entry.startTime),
                        workType: entry.workType,
                        netMinutes,
                        oldPaidTotal: netPaidValue,
                        newAmount: Math.round(newAmount * 100) / 100,
                        diffAmount,
                        retroEntryId: retroEntry.id,
                    });
                }
            }

            const totalDiff = retroEntries.filter((e) => !e.skipped).reduce((sum, e) => sum + (e.diffAmount || 0), 0);

            if (retroEntries.length > 0) {
                grandTotalDiff += totalDiff;
                results.push({
                    employeeId,
                    firstName: employee.firstName,
                    lastName: employee.lastName,
                    entries: retroEntries,
                    totalDiff: Math.round(totalDiff * 100) / 100,
                });
            }
        }

        return {
            data: results,
            summary: {
                totalEmployees: results.length,
                totalDiff: Math.round(grandTotalDiff * 100) / 100,
            },
        };
    }
}

export default new EmployeeService();

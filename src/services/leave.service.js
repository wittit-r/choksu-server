import { Op } from "sequelize";

import { Employee, Holiday, Leave, LeaveEntitlement, LeaveType, TimeEntry } from "../database/index.js";
import err from "../utils/error.js";
import { combineDateAndTime, toLocalDate } from "../utils/date.js";
import { effectiveMinutes } from "../utils/work-time.js";
import entitlementService from "./leave-entitlement.service.js";

const MINUTES_PER_DAY = 480;
const WORK_START_MIN = 8 * 60;   // 08:00
const WORK_END_MIN = 17 * 60;    // 17:00

/**
 * Service สำหรับบันทึกวันลา (รายชั่วโมง ละเอียดถึงนาที)
 *
 * 1 รายการ = 1 วัน + ช่วงเวลา (ลาหลายวัน = หลายรายการ)
 *
 * Validation ตาม spec section B:
 * 1. ช่วงเวลาถูกต้อง (timeIn < timeOut)
 * 2. พนักงานกะ (shiftType=SHIFT) ลาได้ทั้ง 24 ชม. / ปกติได้เฉพาะ 08:00–17:00
 * 3. ห้ามลาในวันหยุดนักขัตฤกษ์
 * 4. ห้ามซ้อนทับกับการลาอื่น
 * 5. ห้ามซ้อนทับกับเวลาทำงาน (TimeEntry)
 * 6. เวลาทำงาน + เวลาลา ของวันนั้นรวมกัน ≤ 480 นาที
 * 7. ห้ามเกินยอดสิทธิ์คงเหลือทั้งปี (block — เกิน = วันนั้นกลายเป็นขาดงาน)
 */
class LeaveService {
    /**
     * รายการการลา
     * @param {Object} params
     * @param {number} [params.employeeId]
     * @param {number} [params.year]
     * @param {number} [params.month] - 1-12
     */
    async getLeaves({ employeeId, year, month } = {}) {
        const where = {};
        if (employeeId) where.employeeId = employeeId;
        if (year) {
            where.startTime = month
                ? { [Op.gte]: new Date(year, month - 1, 1), [Op.lt]: new Date(year, month, 1) }
                : { [Op.gte]: new Date(year, 0, 1), [Op.lt]: new Date(year + 1, 0, 1) };
        }
        return Leave.findAll({
            where,
            include: [{ association: "leaveType", attributes: ["id", "name"] }],
            order: [["startTime", "ASC"]],
        });
    }

    async getLeaveById({ id }) {
        const leave = await Leave.findByPk(id, {
            include: [{ association: "leaveType", attributes: ["id", "name"] }],
        });
        if (!leave) throw err.notFound({ id });
        return leave;
    }

    /**
     * บันทึกการลา (validate ครบทั้ง 7 ข้อตาม spec)
     * @param {Object} data
     * @param {number} data.employeeId
     * @param {number} data.leaveTypeId
     * @param {string} data.date - "YYYY-MM-DD"
     * @param {string} data.timeIn - "HH:mm"
     * @param {string} data.timeOut - "HH:mm"
     * @param {number} data.createBy
     * @param {string} [data.note]
     */
    async createLeave({ employeeId, leaveTypeId, date, timeIn, timeOut, note, createBy }) {
        const employee = await Employee.findByPk(employeeId, {
            attributes: ["id", "shiftType"],
        });
        if (!employee) throw err.notFound({ employeeId }, "ไม่พบพนักงาน");

        const leaveType = await LeaveType.findByPk(leaveTypeId);
        if (!leaveType) throw err.notFound({ leaveTypeId }, "ไม่พบชนิดวันลา");
        if (!leaveType.isActive) {
            throw err.validation({ leaveTypeId }, "ชนิดวันลานี้ถูกปิดการใช้งานแล้ว");
        }

        const startTime = combineDateAndTime(date, `${timeIn}:00`);
        const endTime = combineDateAndTime(date, `${timeOut}:00`);
        const leaveMinutes = effectiveMinutes(startTime, endTime);
        if (leaveMinutes <= 0) {
            throw err.validation({ timeIn, timeOut }, "ช่วงเวลาลาไม่ถูกต้อง (timeIn ต้องก่อน timeOut)");
        }

        // 2. ช่วงเวลาลา — พนักงานปกติได้เฉพาะ 08:00–17:00 / กะได้ทั้ง 24 ชม.
        if (employee.shiftType !== "SHIFT") {
            const inMin = startTime.getHours() * 60 + startTime.getMinutes();
            const outMin = endTime.getHours() * 60 + endTime.getMinutes();
            if (inMin < WORK_START_MIN || outMin > WORK_END_MIN) {
                throw err.validation(
                    { timeIn, timeOut },
                    "พนักงานปกติลาได้เฉพาะช่วงเวลาทำงาน 08:00–17:00 เท่านั้น",
                );
            }
        }

        // 3. ห้ามลาในวันหยุดนักขัตฤกษ์
        const [y, m, d] = date.split("-").map(Number);
        const holiday = await Holiday.findOne({ where: { holidayDate: new Date(y, m - 1, d) } });
        if (holiday) {
            throw err.validation({ date }, `วันที่ ${date} เป็นวันหยุดนักขัตฤกษ์ (${holiday.name}) — ห้ามบันทึกวันลา`);
        }

        // 4. ห้ามซ้อนทับกับการลาอื่น
        const overlapLeave = await Leave.findOne({
            where: {
                employeeId,
                startTime: { [Op.lt]: endTime },
                endTime: { [Op.gt]: startTime },
            },
            attributes: ["id"],
        });
        if (overlapLeave) {
            throw err.conflict({ date, timeIn, timeOut }, "ช่วงเวลาลาซ้อนทับกับรายการลาอื่นของพนักงานคนเดียวกัน");
        }

        // 5. ห้ามซ้อนทับกับเวลาทำงาน (REGULAR/OVERTIME เท่านั้น — ACCOMMODATION ไม่มีช่วงเวลาเข้างาน)
        //    เงื่อนไข overlap: entry.startTime < leave.endTime && entry.endTime > leave.startTime
        const overlapEntry = await TimeEntry.findOne({
            where: {
                employeeId,
                isNegative: false,
                workType: { [Op.in]: ["REGULAR", "OVERTIME"] },
                startTime: { [Op.lt]: endTime },
                endTime: { [Op.gt]: startTime },
            },
            attributes: ["id"],
        });
        if (overlapEntry) {
            throw err.conflict(
                { date, timeIn, timeOut },
                "ช่วงเวลาลาซ้อนทับกับเวลาทำงานที่ลงไว้ในใบลงเวลา",
            );
        }

        // 6. เวลาทำงาน + เวลาลา (รวมรายการลาอื่นของวันนั้น) ≤ 480 นาที — เกินต้องแยกเป็น OT
        const dayStart = new Date(y, m - 1, d);
        const dayEnd = new Date(y, m - 1, d + 1);
        const dayTotal = await this._dayWorkAndLeaveMinutes(employeeId, dayStart, dayEnd);
        if (dayTotal + leaveMinutes > MINUTES_PER_DAY) {
            throw err.validation(
                { date },
                `รวมเวลาทำงาน + เวลาลาของวันที่ ${date} เกิน 8 ชม. (เหลือ quota ${MINUTES_PER_DAY - dayTotal} นาที) — เกินส่วนต้องลงเป็น OT`,
            );
        }

        // 7. ห้ามเกินยอดสิทธิ์คงเหลือทั้งปี (block)
        const { data: balances } = await entitlementService.getEntitlements({
            employeeId,
            year: y,
        });
        const balance = balances.find((b) => b.leaveTypeId === leaveTypeId);
        if (!balance || balance.entitledDays === 0) {
            throw err.validation(
                { leaveTypeId, year: y },
                `พนักงานยังไม่มีสิทธิ์วันลาชนิดนี้ในปี ${y} — ต้อง generate สิทธิ์ก่อน`,
            );
        }
        if (balance.remainingMinutes < leaveMinutes) {
            throw err.validation(
                { leaveTypeId, remainingMinutes: balance.remainingMinutes, leaveMinutes },
                `สิทธิ์คงเหลือไม่พอ (เหลือ ${balance.remainingMinutes} นาที ต้องใช้ ${leaveMinutes} นาที) — เกินส่วนถือเป็นการขาดงาน`,
            );
        }

        return Leave.create({ employeeId, leaveTypeId, startTime, endTime, note, createBy });
    }

    /**
     * ลบรายการลา (ลบได้เสมอ — ยอดคงเหลือคำนวณสด ผลเงินกระทบรอบถัดไปเท่านั้น)
     */
    async deleteLeave({ id }) {
        const leave = await Leave.findByPk(id);
        if (!leave) throw err.notFound({ id });
        await leave.destroy();
    }

    /**
     * นาทีทำงาน (REGULAR) + นาทีลาทั้งหมดของวันเดียว
     * @returns {Promise<number>} นาทีรวม
     */
    async _dayWorkAndLeaveMinutes(employeeId, dayStart, dayEnd) {
        const [entries, leaves] = await Promise.all([
            TimeEntry.findAll({
                where: {
                    employeeId,
                    isNegative: false,
                    workType: "REGULAR",
                    startTime: { [Op.gte]: dayStart, [Op.lt]: dayEnd },
                },
                attributes: ["startTime", "endTime", "shiftType"],
            }),
            Leave.findAll({
                where: {
                    employeeId,
                    startTime: { [Op.gte]: dayStart, [Op.lt]: dayEnd },
                },
                attributes: ["startTime", "endTime"],
            }),
        ]);

        let total = 0;
        for (const entry of entries) {
            if (!entry.endTime) continue;
            total += effectiveMinutes(entry.startTime, entry.endTime, {
                lunch: entry.shiftType === "REGULAR",
            });
        }
        for (const leave of leaves) {
            total += effectiveMinutes(leave.startTime, leave.endTime);
        }
        return total;
    }
}

export default new LeaveService();

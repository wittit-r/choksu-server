import { Op } from "sequelize";

import { Employee, Leave, LeaveEntitlement, LeaveType } from "../database/index.js";
import err from "../utils/error.js";
import { effectiveMinutes } from "../utils/work-time.js";

const MINUTES_PER_DAY = 480;

/**
 * Service สำหรับสิทธิ์วันลารายคน (snapshot ต่อปี)
 *
 * กติกา (spec PAYROLL-LEAVE-SPEC-DRAFT.md):
 * - ยอดคงเหลือ "คำนวณสด" จากตาราง Leave ทุกครั้ง — ไม่เก็บ usedDays ซ้ำ
 * - แก้รายคนได้ตลอดปี / ตั้งต่ำกว่าที่ใช้ไปแล้วได้ (ยอดติดลบ = ลาต่อไม่ได้จนปรับยอด)
 * - prorata คนเข้ากลางปี: ปัดขึ้นตามจำนวนเดือนที่เหลือ (เดือนที่เริ่ม = เดือนแรก)
 * - ปีปฏิทิน ไม่สะสมข้ามปี
 */
class LeaveEntitlementService {
    /**
     * ดึงสิทธิ์ทั้งหมดของพนักงาน 1 คนในปีนั้น พร้อมยอดคงเหลือ (คำนวณสด)
     * @param {Object} params
     * @param {number} params.employeeId
     * @param {number} [params.year] - default ปีปัจจุบัน
     * @param {boolean} [params.includeInactiveTypes=false]
     */
    async getEntitlements({ employeeId, year, includeInactiveTypes = false }) {
        const yearNo = year ?? new Date().getFullYear();

        const typeWhere = includeInactiveTypes ? {} : { isActive: true };
        const leaveTypes = await LeaveType.findAll({ where: typeWhere, order: [["id", "ASC"]] });
        const entitlements = await LeaveEntitlement.findAll({
            where: { employeeId, year: yearNo },
        });
        const usedByType = await this._usedMinutesByType(employeeId, yearNo);

        const entitlementMap = new Map(entitlements.map((e) => [e.leaveTypeId, e]));
        const data = leaveTypes.map((type) => {
            const row = entitlementMap.get(type.id);
            const entitledMinutes = (row?.entitledDays ?? 0) * MINUTES_PER_DAY;
            const usedMinutes = usedByType.get(type.id) ?? 0;
            return {
                id: row?.id ?? null,
                employeeId,
                year: yearNo,
                leaveTypeId: type.id,
                leaveTypeName: type.name,
                entitledDays: row?.entitledDays ?? 0,
                entitledMinutes,
                usedMinutes,
                remainingMinutes: entitledMinutes - usedMinutes,
            };
        });

        return { data, year: yearNo };
    }

    /**
     * แก้ยอดสิทธิ์รายคน (แก้ได้ตลอดปี — รวมตั้งต่ำกว่าที่ใช้ไปแล้ว)
     */
    async updateEntitlement({ id, entitledDays }) {
        const entitlement = await LeaveEntitlement.findByPk(id);
        if (!entitlement) throw err.notFound({ id });
        return entitlement.update({ entitledDays });
    }

    /**
     * Generate สิทธิ์ทั้งบริษัทสำหรับปีเป้าหมาย
     * - สร้างเฉพาะ row ที่ยังไม่มี (employeeId × leaveTypeId × year)
     * - คนเริ่มก่อนปีเป้าหมาย = default เต็ม / เริ่มในปีเป้าหมาย = prorata ปัดขึ้น / ยังไม่เริ่มงาน = ข้าม
     * @param {Object} params
     * @param {number} params.year
     */
    async generateEntitlements({ year }) {
        const [employees, leaveTypes] = await Promise.all([
            Employee.findAll({ where: { isActive: true }, attributes: ["id", "startDate"] }),
            LeaveType.findAll({ where: { isActive: true } }),
        ]);

        const yearStart = new Date(year, 0, 1);
        const yearEnd = new Date(year + 1, 0, 1);

        const existing = await LeaveEntitlement.findAll({
            where: { year },
            attributes: ["employeeId", "leaveTypeId"],
        });
        const existingKeys = new Set(existing.map((e) => `${e.employeeId}:${e.leaveTypeId}`));

        let created = 0;
        let skipped = 0;

        for (const employee of employees) {
            if (employee.startDate >= yearEnd) { skipped++; continue; }

            // prorata: เริ่มก่อนปีเป้าหมาย → เต็ม, เริ่มในปีเป้าหมาย → นับเดือนที่เริ่มเป็นเดือนแรก
            let months = 12;
            if (employee.startDate >= yearStart) {
                months = 13 - (employee.startDate.getMonth() + 1);
            }

            for (const type of leaveTypes) {
                const key = `${employee.id}:${type.id}`;
                if (existingKeys.has(key)) continue;

                await LeaveEntitlement.create({
                    employeeId: employee.id,
                    year,
                    leaveTypeId: type.id,
                    entitledDays: Math.ceil((type.defaultDaysPerYear * months) / 12),
                });
                existingKeys.add(key);
                created++;
            }
        }

        return { year, employees: employees.length, created, skipped };
    }

    /**
     * ยอดใช้ไป (นาที) แยกตามชนิด ของพนักงาน 1 คนในปีนั้น — คำนวณสดจากตาราง Leave
     * (นาทีลาหักพักกลางวัน 12:00–13:00 ถ้าคร่อม ตาม spec)
     * @returns {Promise<Map<number, number>>} leaveTypeId → usedMinutes
     */
    async _usedMinutesByType(employeeId, year) {
        const leaves = await Leave.findAll({
            where: {
                employeeId,
                startTime: { [Op.gte]: new Date(year, 0, 1), [Op.lt]: new Date(year + 1, 0, 1) },
            },
            attributes: ["leaveTypeId", "startTime", "endTime"],
        });

        const map = new Map();
        for (const leave of leaves) {
            const minutes = effectiveMinutes(leave.startTime, leave.endTime);
            map.set(leave.leaveTypeId, (map.get(leave.leaveTypeId) ?? 0) + minutes);
        }
        return map;
    }
}

export default new LeaveEntitlementService();

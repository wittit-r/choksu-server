import { Leave, LeaveEntitlement, LeaveType } from "../database/index.js";
import err from "../utils/error.js";

/**
 * Service สำหรับชนิดวันลา (master) — ผู้ใช้เพิ่มชนิด/แก้ default ได้เอง
 * แก้ defaultDaysPerYear กลางปีมีผลกับ generation ครั้งถัดไปเท่านั้น (snapshot semantics)
 */
class LeaveTypeService {
    /**
     * รายการชนิดวันลา (paginated)
     * @param {Object} params
     * @param {boolean} [params.isActive] - กรองเฉพาะใช้งาน/ไม่ใช้งาน
     * @param {number} [params.page=1]
     * @param {number} [params.limit=10]
     */
    async getLeaveTypes({ isActive, page = 1, limit = 10 } = {}) {
        const where = {};
        if (isActive !== undefined) where.isActive = isActive;

        const { rows: data, count: total } = await LeaveType.findAndCountAll({
            where,
            offset: (page - 1) * limit,
            limit,
            order: [["id", "ASC"]],
        });

        return {
            data,
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        };
    }

    async getLeaveTypeById({ id }) {
        const leaveType = await LeaveType.findByPk(id);
        if (!leaveType) throw err.notFound({ id });
        return leaveType;
    }

    /**
     * เพิ่มชนิดวันลาใหม่
     * @param {Object} data
     * @param {string} data.name
     * @param {number} data.defaultDaysPerYear
     */
    async createLeaveType({ name, defaultDaysPerYear }) {
        const existing = await LeaveType.findOne({ where: { name }, attributes: ["id"] });
        if (existing) throw err.conflict({ name }, "ชื่อชนิดวันลานี้มีอยู่แล้ว");
        return LeaveType.create({ name, defaultDaysPerYear, isActive: true });
    }

    /**
     * แก้ไขชนิดวันลา (รวมปิดการใช้งานผ่าน isActive=false)
     */
    async updateLeaveType({ id, ...data }) {
        const leaveType = await LeaveType.findByPk(id);
        if (!leaveType) throw err.notFound({ id });

        if (data.name !== undefined && data.name !== leaveType.name) {
            const existing = await LeaveType.findOne({ where: { name: data.name }, attributes: ["id"] });
            if (existing) throw err.conflict({ name: data.name }, "ชื่อชนิดวันลานี้มีอยู่แล้ว");
        }

        return leaveType.update(data);
    }

    /**
     * ลบชนิดวันลา — ห้ามลบถ้าถูกอ้างโดย Leave หรือ LeaveEntitlement
     * (ให้ปิดการใช้งานด้วย PATCH isActive=false แทน)
     */
    async deleteLeaveType({ id }) {
        const leaveType = await LeaveType.findByPk(id);
        if (!leaveType) throw err.notFound({ id });

        const [leaveCount, entitlementCount] = await Promise.all([
            Leave.count({ where: { leaveTypeId: id } }),
            LeaveEntitlement.count({ where: { leaveTypeId: id } }),
        ]);
        if (leaveCount > 0 || entitlementCount > 0) {
            throw err.validation(
                { leaveCount, entitlementCount },
                "ชนิดวันลานี้ถูกอ้างอิงอยู่ — ใช้ PATCH isActive=false เพื่อปิดการใช้งานแทนการลบ",
            );
        }

        await leaveType.destroy();
    }
}

export default new LeaveTypeService();

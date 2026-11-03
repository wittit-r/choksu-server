import { Op } from "sequelize";

import { Holiday } from "../database/index.js";
import err from "../utils/error.js";

/**
 * Service สำหรับปฏิทินวันหยุดนักขัตฤกษ์ (กรอกมือต่อปี)
 */
class HolidayService {
    /**
     * ดึงรายการวันหยุดตามปี (paginated)
     * @param {Object} params
     * @param {number} [params.year] - ปีที่ต้องการ (ค่าเริ่มต้น = ทุกปี)
     * @param {number} [params.page=1]
     * @param {number} [params.limit=10]
     */
    async getHolidays({ year, page = 1, limit = 10 } = {}) {
        const where = {};
        if (year) {
            where.holidayDate = {
                [Op.gte]: new Date(year, 0, 1),
                [Op.lt]: new Date(year + 1, 0, 1),
            };
        }

        const { rows: data, count: total } = await Holiday.findAndCountAll({
            where,
            offset: (page - 1) * limit,
            limit,
            order: [["holidayDate", "ASC"]],
        });

        return {
            data,
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        };
    }

    /**
     * สร้างวันหยุดใหม่
     * @param {Object} data
     * @param {string} data.date - วันที่ "YYYY-MM-DD"
     * @param {string} data.name - ชื่อวันหยุด
     */
    async createHoliday({ date, name }) {
        const holidayDate = this._toDate(date);

        const existing = await Holiday.findOne({ where: { holidayDate }, attributes: ["id"] });
        if (existing) throw err.conflict({ date }, `วันที่ ${date} เป็นวันหยุดอยู่แล้ว`);

        return Holiday.create({ holidayDate, name });
    }

    /**
     * ลบวันหยุด
     * @param {number} id
     */
    async deleteHoliday({ id }) {
        const holiday = await Holiday.findByPk(id);
        if (!holiday) throw err.notFound({ id });
        await holiday.destroy();
    }

    /**
     * แปลง "YYYY-MM-DD" เป็น Date เที่ยงคืนเวลาไทยตรงๆ
     * (numeric-local constructor — ไม่ขึ้นกับ TZ env และไม่โดน parse เป็น UTC)
     * @param {string} dateStr
     * @returns {Date}
     */
    _toDate(dateStr) {
        const [y, m, d] = dateStr.split("-").map(Number);
        return new Date(y, m - 1, d);
    }
}

export default new HolidayService();

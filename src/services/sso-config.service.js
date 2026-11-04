import { Op } from "sequelize";

import { SsoConfig } from "../database/index.js";
import err from "../utils/error.js";

// เพดานบนสำหรับเทียบ overlap เมื่อ effectiveTo เป็น null (ใช้ตลอดไป)
const UNBOUNDED = new Date(9999, 11, 31);

/**
 * Service สำหรับเงื่อนไขประกันสังคม (sso_config) ตามช่วงเวลา
 *
 * กติกา: ห้ามช่วงเวลาทับกัน (เพื่อให้ lookup ณ วันใดวันหนึ่งได้ผลแถวเดียวเสมอ)
 * แก้/ลบแถวเก่าได้เสมอ — payroll เก็บ snapshot (ssoBase/ssoCap) ไว้แล้ว ยอดเก่าไม่เพี้ยน
 */
class SsoConfigService {
    /**
     * รายการทั้งหมด เรียงตามวันเริ่มใช้ (ตารางมีไม่กี่แถว ไม่ต้อง pagination)
     */
    async getSsoConfigs() {
        return SsoConfig.findAll({ order: [["effectiveFrom", "ASC"]] });
    }

    /**
     * เงื่อนไขที่มีผล ณ วันที่หนึ่ง ๆ (ใช้กับการคำนวณ SSO ของรอบจ่าย)
     * @param {Date} date
     * @param {Object} [tx] - sequelize transaction (ถ้าเรียกใน transaction)
     * @returns {Promise<Object|null>}
     */
    async getConfigAt(date, tx = null) {
        return SsoConfig.findOne({
            where: {
                effectiveFrom: { [Op.lte]: date },
                [Op.or]: [
                    { effectiveTo: null },
                    { effectiveTo: { [Op.gte]: date } },
                ],
            },
            ...(tx && { transaction: tx }),
        });
    }

    /**
     * สร้างเงื่อนไขใหม่
     * @param {Object} data
     * @param {string} data.effectiveFrom - "YYYY-MM-DD"
     * @param {string|null} [data.effectiveTo] - "YYYY-MM-DD" หรือ null = ใช้ตลอดไป
     * @param {number} data.ratePercent - อัตราเรียกเก็บ (%)
     * @param {number} data.maxWage - เพดานค่าจ้าง
     */
    async createSsoConfig({ effectiveFrom, effectiveTo, ratePercent, maxWage }) {
        const from = this._toDate(effectiveFrom);
        const to = effectiveTo ? this._toDate(effectiveTo) : null;
        this._validateRange(from, to);
        await this._ensureNoOverlap(from, to);

        return SsoConfig.create({ effectiveFrom: from, effectiveTo: to, ratePercent, maxWage });
    }

    /**
     * แก้ไขเงื่อนไข (แก้บาง field ได้ — ช่วงเวลาจะใช้ค่าปัจจุบันเติมให้ครบก่อนตรวจ overlap)
     */
    async updateSsoConfig({ id, ...fields }) {
        const config = await SsoConfig.findByPk(id);
        if (!config) throw err.notFound({ id });

        const from = fields.effectiveFrom !== undefined
            ? this._toDate(fields.effectiveFrom)
            : config.effectiveFrom;
        const to = fields.effectiveTo !== undefined
            ? (fields.effectiveTo ? this._toDate(fields.effectiveTo) : null)
            : config.effectiveTo;

        this._validateRange(from, to);
        await this._ensureNoOverlap(from, to, id);

        await config.update({
            effectiveFrom: from,
            effectiveTo: to,
            ...(fields.ratePercent !== undefined && { ratePercent: fields.ratePercent }),
            ...(fields.maxWage !== undefined && { maxWage: fields.maxWage }),
        });
        return config;
    }

    /**
     * ลบเงื่อนไข — ไม่บล็อกแม้มี payroll เคยคำนวณด้วยแถวนี้ (ยอดเก่าอ้าง snapshot ของตัวเอง)
     */
    async deleteSsoConfig({ id }) {
        const config = await SsoConfig.findByPk(id);
        if (!config) throw err.notFound({ id });
        await config.destroy();
    }

    /**
     * from ต้องมาก่อน to (ถ้าระบุ to)
     */
    _validateRange(from, to) {
        if (to && to <= from) {
            throw err.validation(
                { effectiveFrom: from, effectiveTo: to },
                "วันสิ้นสุดต้องมาหลังวันเริ่มใช้",
            );
        }
    }

    /**
     * ห้ามช่วงเวลาทับกับแถวอื่น (ตารางเล็ก — ตรวจใน memory ง่ายกว่าเขียน SQL null-safe)
     * @param {Date} from
     * @param {Date|null} to - null = เปิดไปเรื่อยๆ
     * @param {number} [excludeId] - แถวที่กำลังแก้ (ไม่นับชนตัวเอง)
     */
    async _ensureNoOverlap(from, to, excludeId = null) {
        const rows = await SsoConfig.findAll({ attributes: ["id", "effectiveFrom", "effectiveTo"] });
        for (const row of rows) {
            if (excludeId !== null && row.id === excludeId) continue;
            const rowTo = row.effectiveTo ?? UNBOUNDED;
            if (from <= rowTo && (to ?? UNBOUNDED) >= row.effectiveFrom) {
                throw err.conflict(
                    { effectiveFrom: row.effectiveFrom, effectiveTo: row.effectiveTo },
                    `ช่วงเวลาทับกับเงื่อนไขที่มีอยู่ (${this._format(row.effectiveFrom)} ถึง ${row.effectiveTo ? this._format(row.effectiveTo) : "ตลอดไป"})`,
                );
            }
        }
    }

    /**
     * แปลง "YYYY-MM-DD" เป็น Date เที่ยงคืนเวลาไทยตรงๆ
     * (numeric-local constructor — กัน skew 07:00 เหมือน holiday.service)
     */
    _toDate(dateStr) {
        const [y, m, d] = dateStr.split("-").map(Number);
        return new Date(y, m - 1, d);
    }

    _format(date) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    }
}

export default new SsoConfigService();

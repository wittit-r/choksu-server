import { validate, Joi } from "../utils/validate.js";
import ssoConfigService from "../services/sso-config.service.js";
import ssoReportService from "../services/sso-report.service.js";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_YEAR_SCHEMA = Joi.object({
    month: Joi.number().integer().min(1).max(12).required(),
    year: Joi.number().integer().min(2000).max(2100).required(),
});

class SsoConfigController {
    getSsoConfigs = async (req, res) => {
        const data = await ssoConfigService.getSsoConfigs();

        res.status(200).json({ success: true, data });
    };

    /**
     * ตัวอย่างรายงานนำส่งสปส.รายเดือน (preview หน้าจอ — แหล่งข้อมูลเดียวกับ export)
     */
    getSsoReport = async (req, res) => {
        const query = validate(req.query, MONTH_YEAR_SCHEMA);

        const data = await ssoReportService.buildSsoReport(query);

        res.status(200).json({ success: true, data });
    };

    /**
     * ไฟล์ xlsx รายงานนำส่งสปส.รายเดือน (binary attachment)
     */
    exportSsoReport = async (req, res) => {
        const query = validate(req.query, MONTH_YEAR_SCHEMA);

        const { buffer, filename } = await ssoReportService.exportSsoReport(query);

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.status(200).send(Buffer.from(buffer));
    };

    createSsoConfig = async (req, res) => {
        const body = validate(
            req.body,
            Joi.object({
                effectiveFrom: Joi.string().pattern(DATE_PATTERN).required(),
                effectiveTo: Joi.string().pattern(DATE_PATTERN).allow(null).optional(),
                ratePercent: Joi.number().precision(2).min(0.01).max(100).required(),
                maxWage: Joi.number().precision(2).min(0).required(),
            }),
        );

        const data = await ssoConfigService.createSsoConfig(body);

        res.status(201).json({ success: true, data });
    };

    updateSsoConfig = async (req, res) => {
        const { id } = validate(
            req.params,
            Joi.object({
                id: Joi.number().integer().required(),
            }),
        );

        const body = validate(
            req.body,
            Joi.object({
                effectiveFrom: Joi.string().pattern(DATE_PATTERN),
                effectiveTo: Joi.string().pattern(DATE_PATTERN).allow(null),
                ratePercent: Joi.number().precision(2).min(0.01).max(100),
                maxWage: Joi.number().precision(2).min(0),
            }).min(1),
        );

        const data = await ssoConfigService.updateSsoConfig({ id, ...body });

        res.status(200).json({ success: true, data });
    };

    deleteSsoConfig = async (req, res) => {
        const { id } = validate(
            req.params,
            Joi.object({
                id: Joi.number().integer().required(),
            }),
        );

        await ssoConfigService.deleteSsoConfig({ id });

        res.status(200).json({ success: true });
    };
}

export default new SsoConfigController();

import { validate, Joi } from "../utils/validate.js";
import payPeriodService from "../services/pay-period.service.js";

class PayPeriodController {
    getPayPeriods = async (req, res) => {
        const query = validate(req.query, Joi.object({
            year: Joi.number().integer(),
            employeeType: Joi.string().valid('WORKER', 'DRIVER'),
            status: Joi.string().valid('OPEN', 'CLOSED'),
            page: Joi.number().integer().default(1),
            limit: Joi.number().integer().default(10),
            sort: Joi.string().valid('asc', 'desc').default('desc'),
            sortBy: Joi.string().valid('startDate', 'periodNo', 'createdAt').default('startDate'),
        }));

        const result = await payPeriodService.getPayPeriods(query);
        res.status(200).json({ success: true, ...result });
    };

    getPayPeriodById = async (req, res) => {
        const { id } = validate(req.params, Joi.object({
            id: Joi.number().integer().required(),
        }));

        const data = await payPeriodService.getPayPeriodById(id);
        res.status(200).json({ success: true, data });
    };

    createPayPeriod = async (req, res) => {
        const body = validate(req.body, Joi.object({
            periodNo: Joi.number().integer().min(1).max(24).required(),
            year: Joi.number().integer().min(2000).max(2100).required(),
            employeeType: Joi.string().valid('WORKER', 'DRIVER').required(),
            startDate: Joi.date().iso().required(),
            endDate: Joi.date().iso().required().greater(Joi.ref('startDate')),
        }));

        const data = await payPeriodService.createPayPeriod(body);
        res.status(201).json({ success: true, data });
    };

    createPayrolls = async (req, res) => {
        const { id } = validate(req.params, Joi.object({
            id: Joi.number().integer().required(),
        }));

        const body = validate(req.body, Joi.object({
            employeeId: Joi.number().integer(),
        }));

        const result = await payPeriodService.createPayrollsForPeriod(id, body);
        res.status(201).json({ success: true, ...result });
    };

    cancelAllPayrolls = async (req, res) => {
        const { id } = validate(req.params, Joi.object({
            id: Joi.number().integer().required(),
        }));

        const result = await payPeriodService.cancelAllPayrolls(id);
        res.status(200).json({ success: true, ...result });
    };

    recalculatePayPeriod = async (req, res) => {
        const { id } = validate(req.params, Joi.object({
            id: Joi.number().integer().required(),
        }));

        const result = await payPeriodService.recalculatePayPeriod(id);
        res.status(200).json({ success: true, ...result });
    };

    exportPayPeriod = async (req, res) => {
        const { id } = validate(req.params, Joi.object({
            id: Joi.number().integer().required(),
        }));

        const result = await payPeriodService.exportPayPeriod(id);
        res.status(200).json({ success: true, ...result });
    };

    closePayPeriod = async (req, res) => {
        const { id } = validate(req.params, Joi.object({
            id: Joi.number().integer().required(),
        }));

        const query = validate(req.query, Joi.object({
            force: Joi.boolean().default(false),
        }));

        const result = await payPeriodService.closePayPeriod(id, query);
        res.status(200).json({ success: true, ...result });
    };

    reopenPayPeriod = async (req, res) => {
        const { id } = validate(req.params, Joi.object({
            id: Joi.number().integer().required(),
        }));

        const data = await payPeriodService.reopenPayPeriod(id);
        res.status(200).json({ success: true, data });
    };

    importBankFile = async (req, res) => {
        const { id } = validate(req.params, Joi.object({
            id: Joi.number().integer().required(),
        }));

        const result = await payPeriodService.importBankFile(id);
        res.status(200).json({ success: true, ...result });
    };

}

export default new PayPeriodController();

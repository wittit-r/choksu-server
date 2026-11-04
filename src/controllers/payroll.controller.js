import { validate, Joi } from "../utils/validate.js";
import payrollService from "../services/payroll.service.js";

class PayrollController {
    getPayrolls = async (req, res) => {
        const query = validate(req.query, Joi.object({
            payPeriodId: Joi.number().integer(),
            employeeId: Joi.number().integer(),
            status: Joi.string().valid('PENDING', 'CALCULATED', 'PAID', 'CANCELLED'),
            year: Joi.number().integer(),
            employeeType: Joi.string().valid('WORKER', 'DRIVER'),
            page: Joi.number().integer().default(1),
            limit: Joi.number().integer().default(10),
            sort: Joi.string().valid('asc', 'desc').default('asc'),
            sortBy: Joi.string().valid('id', 'createdAt').default('id'),
        }));

        const result = await payrollService.getPayrolls(query);
        res.status(200).json({ success: true, ...result });
    };

    getPayrollById = async (req, res) => {
        const { id } = validate(req.params, Joi.object({
            id: Joi.number().integer().required(),
        }));

        const data = await payrollService.getPayrollById(id);
        res.status(200).json({ success: true, data });
    };

    updatePayroll = async (req, res) => {
        const { id } = validate(req.params, Joi.object({
            id: Joi.number().integer().required(),
        }));

        const body = validate(req.body, Joi.object({
            ssoAmount: Joi.number().precision(2).min(0),
            slfAmount: Joi.number().precision(2).min(0),
            otherDeduction: Joi.number().precision(2).min(0),
            allowExported: Joi.boolean().default(false),
        }).or('ssoAmount', 'slfAmount', 'otherDeduction'));

        const { allowExported, ...data } = body;
        const updated = await payrollService.updatePayroll(id, data, { allowExported });
        res.status(200).json({ success: true, data: updated });
    };

    cancelPayroll = async (req, res) => {
        const { id } = validate(req.params, Joi.object({
            id: Joi.number().integer().required(),
        }));

        const { allowExported } = validate(req.body || {}, Joi.object({
            allowExported: Joi.boolean().default(false),
        }));

        const result = await payrollService.cancelPayroll(id, { allowExported });
        res.status(200).json({ success: true, ...result });
    };

    recalculatePayroll = async (req, res) => {
        const { id } = validate(req.params, Joi.object({
            id: Joi.number().integer().required(),
        }));

        const { allowExported } = validate(req.body || {}, Joi.object({
            allowExported: Joi.boolean().default(false),
        }));

        const result = await payrollService.recalculatePayroll(id, { allowExported });
        res.status(200).json({ success: true, data: result });
    };

    calculateRetroactive = async (req, res) => {
        const body = validate(req.body, Joi.object({
            startDate: Joi.date().iso().required(),
            endDate: Joi.date().iso().required().greater(Joi.ref('startDate')),
        }));

        const result = await payrollService.calculateRetroactive(body);
        res.status(200).json({ success: true, ...result });
    };
}

export default new PayrollController();

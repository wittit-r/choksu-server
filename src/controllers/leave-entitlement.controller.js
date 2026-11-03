import { validate, Joi } from "../utils/validate.js";
import leaveEntitlementService from "../services/leave-entitlement.service.js";

class LeaveEntitlementController {
    getEntitlements = async (req, res) => {
        const query = validate(
            req.query,
            Joi.object({
                employeeId: Joi.number().integer().required(),
                year: Joi.number().integer().min(1900).max(3000),
                includeInactiveTypes: Joi.boolean().default(false),
            }),
        );

        const result = await leaveEntitlementService.getEntitlements(query);

        res.status(200).json({ success: true, ...result });
    };

    updateEntitlement = async (req, res) => {
        const { id } = validate(
            req.params,
            Joi.object({
                id: Joi.number().integer().required(),
            }),
        );

        const body = validate(
            req.body,
            Joi.object({
                entitledDays: Joi.number().integer().min(0).required(),
            }),
        );

        const data = await leaveEntitlementService.updateEntitlement({ id, ...body });

        res.status(200).json({ success: true, data });
    };

    generateEntitlements = async (req, res) => {
        const body = validate(
            req.body,
            Joi.object({
                year: Joi.number().integer().min(1900).max(3000).required(),
            }),
        );

        const result = await leaveEntitlementService.generateEntitlements(body);

        res.status(201).json({ success: true, data: result });
    };
}

export default new LeaveEntitlementController();

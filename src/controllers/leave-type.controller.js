import { validate, Joi } from "../utils/validate.js";
import leaveTypeService from "../services/leave-type.service.js";

class LeaveTypeController {
    getLeaveTypes = async (req, res) => {
        const query = validate(
            req.query,
            Joi.object({
                isActive: Joi.boolean(),
                page: Joi.number().integer().min(1).default(1),
                limit: Joi.number().integer().min(1).max(100).default(10),
            }),
        );

        const { data, pagination } = await leaveTypeService.getLeaveTypes(query);

        res.status(200).json({ success: true, data, pagination });
    };

    getLeaveTypeById = async (req, res) => {
        const { id } = validate(
            req.params,
            Joi.object({
                id: Joi.number().integer().required(),
            }),
        );

        const data = await leaveTypeService.getLeaveTypeById({ id });

        res.status(200).json({ success: true, data });
    };

    createLeaveType = async (req, res) => {
        const body = validate(
            req.body,
            Joi.object({
                name: Joi.string().required(),
                defaultDaysPerYear: Joi.number().integer().min(0).required(),
            }),
        );

        const data = await leaveTypeService.createLeaveType(body);

        res.status(201).json({ success: true, data });
    };

    updateLeaveType = async (req, res) => {
        const { id } = validate(
            req.params,
            Joi.object({
                id: Joi.number().integer().required(),
            }),
        );

        const body = validate(
            req.body,
            Joi.object({
                name: Joi.string(),
                defaultDaysPerYear: Joi.number().integer().min(0),
                isActive: Joi.boolean(),
            }).min(1),
        );

        const data = await leaveTypeService.updateLeaveType({ id, ...body });

        res.status(200).json({ success: true, data });
    };

    deleteLeaveType = async (req, res) => {
        const { id } = validate(
            req.params,
            Joi.object({
                id: Joi.number().integer().required(),
            }),
        );

        await leaveTypeService.deleteLeaveType({ id });

        res.status(200).json({ success: true });
    };
}

export default new LeaveTypeController();

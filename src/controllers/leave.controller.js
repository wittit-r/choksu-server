import { validate, Joi } from "../utils/validate.js";
import leaveService from "../services/leave.service.js";

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

class LeaveController {
    getLeaves = async (req, res) => {
        const query = validate(
            req.query,
            Joi.object({
                employeeId: Joi.number().integer(),
                year: Joi.number().integer().min(1900).max(3000),
                month: Joi.number().integer().min(1).max(12),
            }),
        );

        const data = await leaveService.getLeaves(query);

        res.status(200).json({ success: true, data });
    };

    getLeaveById = async (req, res) => {
        const { id } = validate(
            req.params,
            Joi.object({
                id: Joi.number().integer().required(),
            }),
        );

        const data = await leaveService.getLeaveById({ id });

        res.status(200).json({ success: true, data });
    };

    createLeave = async (req, res) => {
        const body = validate(
            req.body,
            Joi.object({
                employeeId: Joi.number().integer().required(),
                leaveTypeId: Joi.number().integer().required(),
                date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
                timeIn: Joi.string().pattern(TIME_PATTERN).required(),
                timeOut: Joi.string().pattern(TIME_PATTERN).required(),
                note: Joi.string().allow(null, ""),
                createBy: Joi.number().integer(),
            }),
        );

        const data = await leaveService.createLeave(body);

        res.status(201).json({ success: true, data });
    };

    deleteLeave = async (req, res) => {
        const { id } = validate(
            req.params,
            Joi.object({
                id: Joi.number().integer().required(),
            }),
        );

        await leaveService.deleteLeave({ id });

        res.status(200).json({ success: true });
    };
}

export default new LeaveController();

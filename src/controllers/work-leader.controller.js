import { validate, Joi } from "../utils/validate.js";
import workLeaderService from "../services/work-leader.service.js";

class WorkLeaderController {
    getWorkLeaders = async (req, res) => {
        const query = validate(
            req.query,
            Joi.object({
                search: Joi.string(),
                isActive: Joi.boolean(),
                branchId: Joi.number().integer(),
                page: Joi.number().integer().default(1),
                limit: Joi.number().integer().default(10),
                sort: Joi.string().valid('asc', 'desc').default('asc'),
                sortBy: Joi.string().valid('id', 'name', 'refNo', 'createdAt').default('id'),
            }),
        );

        const { data, pagination } = await workLeaderService.getWorkLeaders(query);

        res.status(200).json({
            success: true,
            data,
            pagination,
        });
    };

    createWorkLeader = async (req, res) => {
        const body = validate(
            req.body,
            Joi.object({
                name: Joi.string().required(),
                refNo: Joi.string().allow(null, ''),
                branchId: Joi.number().integer().required(),
                isActive: Joi.boolean().default(true),
            }),
        );

        const workLeader = await workLeaderService.createWorkLeader(body);

        res.status(201).json({
            success: true,
            data: workLeader,
        });
    };

    updateWorkLeader = async (req, res) => {
        const params = validate(
            req.params,
            Joi.object({
                id: Joi.number().integer().required(),
            }),
        );

        const body = validate(
            req.body,
            Joi.object({
                name: Joi.string(),
                refNo: Joi.string().allow(null, ''),
                branchId: Joi.number().integer(),
                isActive: Joi.boolean(),
            }).min(1),
        );

        const workLeader = await workLeaderService.updateWorkLeader(params.id, body);

        res.status(200).json({
            success: true,
            data: workLeader,
        });
    };
}

export default new WorkLeaderController();

import { validate, Joi } from "../utils/validate.js";
import positionService from "../services/position.service.js";

class PositionController {
    getPositions = async (req, res) => {
        const query = validate(
            req.query,
            Joi.object({
                search: Joi.string(),
                isActive: Joi.boolean(),
                employeeType: Joi.string().valid('WORKER', 'DRIVER'),
                page: Joi.number().integer().default(1),
                limit: Joi.number().integer().default(10),
                sort: Joi.string().valid('asc', 'desc').default('asc'),
                sortBy: Joi.string().valid('id', 'name', 'code', 'createdAt').default('id'),
            }),
        );

        const { data, pagination } = await positionService.getPositions(query);

        res.status(200).json({
            success: true,
            data,
            pagination,
        });
    };

    createPosition = async (req, res) => {
        const body = validate(
            req.body,
            Joi.object({
                name: Joi.string().required(),
                code: Joi.string().required(),
                employeeType: Joi.string().valid('WORKER', 'DRIVER').required(),
                isActive: Joi.boolean().default(true),
            }),
        );

        const position = await positionService.createPosition(body);

        res.status(201).json({
            success: true,
            data: position,
        });
    };

    updatePosition = async (req, res) => {
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
                code: Joi.string(),
                employeeType: Joi.string().valid('WORKER', 'DRIVER'),
                isActive: Joi.boolean(),
            }).min(1),
        );

        const position = await positionService.updatePosition(params.id, body);

        res.status(200).json({
            success: true,
            data: position,
        });
    };
}

export default new PositionController();

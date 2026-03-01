import { validate, Joi } from "../utils/validate.js";
import branchService from "../services/branch.service.js";

class BranchController {
    getBranches = async (req, res) => {
        const query = validate(
            req.query,
            Joi.object({
                search: Joi.string(),
                page: Joi.number().integer().default(1),
                limit: Joi.number().integer().default(10),
                sort: Joi.string().valid('asc', 'desc').default('asc'),
                sortBy: Joi.string().valid('id', 'name', 'fullname', 'createdAt').default('id'),
            }),
        );

        const { data, pagination } = await branchService.getBranches(query);

        res.status(200).json({
            success: true,
            data,
            pagination,
        });
    };

    getBranchById = async (req, res) => {
        const { id } = validate(
            req.params,
            Joi.object({
                id: Joi.number().integer().required(),
            })
        );

        const branch = await branchService.getBranchById({ id });

        res.status(200).json({
            success: true,
            data: branch,
        });
    };

    createBranch = async (req, res) => {
        const body = validate(
            req.body,
            Joi.object({
                name: Joi.string().required(),
                fullname: Joi.string().required(),
            }),
        );

        const branch = await branchService.createBranch(body);

        res.status(201).json({
            success: true,
            data: branch,
        });
    };

    updateBranch = async (req, res) => {
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
                fullname: Joi.string(),
            }).min(1),
        );

        const branch = await branchService.updateBranch(params.id, body);

        res.status(200).json({
            success: true,
            data: branch,
        });
    };
}

export default new BranchController();

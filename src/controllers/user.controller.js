import { validate, Joi } from "../utils/validate.js";
import userService from "../services/user.service.js";

class UserController {
    getUsers = async (req, res) => {
        const query = validate(
            req.query,
            Joi.object({
                search: Joi.string(),
                role: Joi.string().valid('SUPER_ADMIN', 'SENOIR_ACCOUNTING', 'ACCOUNTING', 'COORDINATOR'),
                isActive: Joi.boolean(),
                page: Joi.number().integer().default(1),
                limit: Joi.number().integer().default(10),
                sort: Joi.string().valid('asc', 'desc').default('asc'),
                sortBy: Joi.string().valid('firstName', 'lastName', 'username', 'role', 'createdAt').default('id'),
            })
        );

        const { data, pagination } = await userService.getUsers(query);

        res.status(200).json({ success: true, data, pagination });
    };

    getUserById = async (req, res) => {
        const { id } = validate(
            req.params,
            Joi.object({ id: Joi.number().integer().required() })
        );

        const user = await userService.getUserById({ id });

        res.status(200).json({ success: true, data: user });
    };

    createUser = async (req, res) => {
        const body = validate(
            req.body,
            Joi.object({
                firstName: Joi.string().required(),
                lastName: Joi.string().required(),
                username: Joi.string().required().min(3).max(50),
                password: Joi.string().required().min(6),
                phone: Joi.string(),
                role: Joi.string().valid('SUPER_ADMIN', 'SENOIR_ACCOUNTING', 'ACCOUNTING', 'COORDINATOR'),
                branchId: Joi.number().integer(),
            })
        );

        const user = await userService.createUser(body);

        res.status(201).json({ success: true, data: user });
    };

    updateUser = async (req, res) => {
        const { id } = validate(
            req.params,
            Joi.object({ id: Joi.number().integer().required() })
        );

        const body = validate(
            req.body,
            Joi.object({
                firstName: Joi.string().not(''),
                lastName: Joi.string().not(''),
                username: Joi.string().min(3).max(50).not(''),
                password: Joi.string().min(6).not(''),
                phone: Joi.string().allow(null),
                role: Joi.string().valid('SUPER_ADMIN', 'SENOIR_ACCOUNTING', 'ACCOUNTING', 'COORDINATOR'),
                branchId: Joi.number().integer().allow(null),
                isActive: Joi.boolean(),
                isDeleted: Joi.boolean().valid(true),
            }).min(1)
        );

        const user = await userService.updateUser({ id, ...body });

        res.status(200).json({ success: true, data: user });
    };
}

export default new UserController();

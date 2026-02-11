import { validate, Joi } from "../utils/validate.js";
import employeeService from "../services/employee.service.js";

class EmployeeController {
    getEmployees = async (req, res) => {
        const query = validate(
            req.query,
            Joi.object({
                search: Joi.string(),
                isActive: Joi.boolean(),
                page: Joi.number().integer().default(1),
                limit: Joi.number().integer().default(10),
                sort: Joi.string().valid('asc', 'desc').default('asc'),
                sortBy: Joi.string().valid('name', 'email', 'createdAt').default('createdAt'),
            }),
        )

        const { data, pagination } = await employeeService.getEmployees(query);

        res.status(200).json({
            status: "success",
            data,
            pagination,
        });
    }

    getEmployeeById = async (req, res) => {
        const { id } = validate(
            req.params,
            Joi.object({
                id: Joi.number().integer().required(),
            })
        );

        const employee = await employeeService.getEmployeeById({ id });

        res.status(200).json({
            status: "success",
            data: employee,
        });
    }

    createEmployee = async (req, res) => {
        const body = validate(
            req.body,
            Joi.object({
                firstName: Joi.string().required(),
                lastName: Joi.string().required(),
                idCard: Joi.string().required(),
                phone: Joi.string().required(),
            }),
        );

        const employee = await employeeService.createEmployee(body);

        res.status(200).json({
            status: "success",
            data: employee,
        });
    }

    updateEmployee = async (req, res) => {
        // Validate params
        const { id } = validate(
            req.params,
            Joi.object({
                id: Joi.number().integer().required(),
            })
        );

        const body = validate(
            req.body,
            Joi.object({
                firstName: Joi.string().not(''),
                lastName: Joi.string().not(''),
                idCard: Joi.string().not(''),
                phone: Joi.string().not(''),
                isActive: Joi.boolean(),
            }).min(1) // ต้องส่งมาอย่างน้อย 1 ฟิลด์
        );

        const employee = await employeeService.updateEmployee(id, body);

        res.status(200).json({
            status: "success",
            data: employee,
        });
    }

    createEmployeeUser = async (req, res) => {
        const { id } = validate(
            req.params,
            Joi.object({
                id: Joi.number().integer().required(),
            }),
        );

        const body = validate(
            req.body,
            Joi.object({
                username: Joi.string().required().min(3).max(50),
                password: Joi.string().required().min(6),
            }),
        );

        const user = await employeeService.createUser({ id, ...body });

        res.status(200).json({
            status: "success",
            data: user,
        });
    }

    updateEmployeeUser = async (req, res) => {
        // Validate params
        const { id, userId } = validate(
            req.params,
            Joi.object({
                id: Joi.number().integer().required(),
                userId: Joi.number().integer().required(),
            })
        );

        // Validate body
        const body = validate(
            req.body,
            Joi.object({
                username: Joi.string().min(3).max(50).not(''),
                password: Joi.string().min(6).not(''),
                role: Joi.string().valid('SUPER_ADMIN', 'SENOIR_ACCOUNTING', 'ACCOUNTING', 'COORDINATOR'),
                isActive: Joi.boolean(),
                isDeleted: Joi.boolean().valid(true), // ลบได้เท่านั้น
            }).min(1) // ต้องส่งมาอย่างน้อย 1 ฟิลด์
        );

        const user = await employeeService.updateEmployeeUser({ employeeId: id, userId, ...body });

        res.status(200).json({
            status: "success",
            data: user,
        });
    }
}

export default new EmployeeController();
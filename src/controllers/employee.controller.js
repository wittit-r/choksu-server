import { validate, Joi } from "../utils/validate.js";
import employeeService from "../services/employee.service.js";

class EmployeeController {
    getEmployees = async (req, res) => {
        const query = validate(
            req.query,
            Joi.object({
                search: Joi.string(),
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

    createEmployee = async (req, res) => {
        const body = validate(
            req.body,
            Joi.object({
                name: Joi.string().required(),
            }),
        );

        const employee = await employeeService.createEmployee(body);

        res.status(200).json({
            status: "success",
            data: employee,
        });
    }
}

export default new EmployeeController();
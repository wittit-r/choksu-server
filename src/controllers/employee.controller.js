import { validate, Joi } from "../utils/validate.js";
import employeeService from "../services/employee.service.js";

class EmployeeController {
    getEmployees = async (req, res) => {
        const query = validate(
            req.query,
            Joi.object({
                search: Joi.string(),
                isActive: Joi.boolean(),
                workLeaderId: Joi.number().integer(),
                branchId: Joi.number().integer(),
                page: Joi.number().integer().default(1),
                limit: Joi.number().integer().default(10),
                sort: Joi.string().valid('asc', 'desc').default('asc'),
                sortBy: Joi.string().valid('firstName', 'startDate', 'createdAt').default('id'),
            }),
        )

        const { data, pagination } = await employeeService.getEmployees(query);

        res.status(200).json({
            success: true,
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
            success: true,
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
                phone: Joi.string().allow(null, ''),
                bankAccount: Joi.string().allow(null, ''),
                employeeType: Joi.string().valid('WORKER', 'DRIVER').required(),
                shiftType: Joi.string().valid('REGULAR', 'SHIFT').required(),
                positionId: Joi.number().integer().required(),
                workLeaderId: Joi.number().integer().required(),
                startDate: Joi.date().iso().required(),
            }),
        );

        const employee = await employeeService.createEmployee(body);

        res.status(200).json({
            success: true,
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
                phone: Joi.string().allow(null, ''),
                bankAccount: Joi.string().allow(null, ''),
                employeeType: Joi.string().valid('WORKER', 'DRIVER'),
                shiftType: Joi.string().valid('REGULAR', 'SHIFT'),
                positionId: Joi.number().integer(),
                workLeaderId: Joi.number().integer(),
                startDate: Joi.date().iso(),
                isActive: Joi.boolean(),
            }).min(1) // ต้องส่งมาอย่างน้อย 1 ฟิลด์
        );

        const employee = await employeeService.updateEmployee(id, body);

        res.status(200).json({
            success: true,
            data: employee,
        });
    }

    getWages = async (req, res) => {
        const { employeeId } = validate(
            req.params,
            Joi.object({
                employeeId: Joi.number().integer().required(),
            })
        );

        const query = validate(
            req.query,
            Joi.object({
                page: Joi.number().integer().default(1),
                limit: Joi.number().integer().default(10),
                sort: Joi.string().valid('asc', 'desc').default('asc'),
                sortBy: Joi.string().valid('effectiveFrom', 'effectiveTo', 'createdAt').default('effectiveFrom'),
            })
        );

        const { data, pagination } = await employeeService.getWagesByEmployeeId({
            employeeId,
            ...query,
        });

        res.status(200).json({
            success: true,
            data,
            pagination,
        });
    }

    createWage = async (req, res) => {
        const { employeeId } = validate(
            req.params,
            Joi.object({
                employeeId: Joi.number().integer().required(),
            })
        );

        const body = validate(
            req.body,
            Joi.object({
                positionId: Joi.number().integer().required(),
                dailyRate: Joi.number().precision(3).min(0).required(),
                hourlyRate: Joi.number().precision(3).min(0).required(),
                minuteRate: Joi.number().precision(3).min(0).required(),
                monthlyRate: Joi.number().precision(3).min(0).required(),
                effectiveFrom: Joi.date().iso().required(),
                effectiveTo: Joi.date().iso().allow(null),
                note: Joi.string().allow(null, ''),
            })
        );

        const wage = await employeeService.createWage({
            employeeId,
            ...body,
        });

        res.status(200).json({
            success: true,
            data: wage,
        });
    }

    updateWage = async (req, res) => {
        const { employeeId, id } = validate(
            req.params,
            Joi.object({
                employeeId: Joi.number().integer().required(),
                id: Joi.number().integer().required(),
            })
        );

        const body = validate(
            req.body,
            Joi.object({
                positionId: Joi.number().integer(),
                dailyRate: Joi.number().precision(3).min(0),
                hourlyRate: Joi.number().precision(3).min(0),
                minuteRate: Joi.number().precision(3).min(0),
                monthlyRate: Joi.number().precision(3).min(0),
                effectiveFrom: Joi.date().iso(),
                effectiveTo: Joi.date().iso().allow(null),
                note: Joi.string().allow(null, ''),
            }).min(1)
        );

        const wage = await employeeService.updateWage(id, employeeId, body);

        res.status(200).json({
            success: true,
            data: wage,
        });
    }
}

export default new EmployeeController();

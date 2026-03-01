import { validate, Joi } from "../utils/validate.js";
import timeSheetService from "../services/timesheet.service.js";

class TimeSheetController {
    getTimeSheets = async (req, res) => {
        const query = validate(
            req.query,
            Joi.object({
                sheetType: Joi.string().valid('DAILY', 'MONTHLY'),
                status: Joi.string().valid('PENDING', 'FILLED', 'LOCKED'),
                workLeaderId: Joi.number().integer(),
                employeeId: Joi.number().integer(),
                monthPeriod: Joi.string().pattern(/^\d{4}-\d{2}$/),
                page: Joi.number().integer().default(1),
                limit: Joi.number().integer().default(10),
                sort: Joi.string().valid('asc', 'desc').default('desc'),
                sortBy: Joi.string().valid('workDate', 'monthPeriod', 'createdAt').default('createdAt'),
            }),
        );

        const { data, pagination } = await timeSheetService.getTimeSheets(query);

        res.status(200).json({
            success: true,
            data,
            pagination,
        });
    };

    getTimeSheetById = async (req, res) => {
        const { id } = validate(
            req.params,
            Joi.object({
                id: Joi.number().integer().required(),
            }),
        );

        const timeSheet = await timeSheetService.getTimeSheetById({ id });

        res.status(200).json({
            success: true,
            data: timeSheet,
        });
    };

    createTimeSheet = async (req, res) => {
        const body = validate(
            req.body,
            Joi.object({
                sheetType: Joi.string().valid('DAILY', 'MONTHLY').required(),
                // DAILY fields
                workLeaderId: Joi.number().integer(),
                workDate: Joi.date().iso(),
                // MONTHLY fields
                employeeId: Joi.number().integer(),
                monthPeriod: Joi.string().pattern(/^\d{4}-\d{2}$/),
            }).custom((value, helpers) => {
                // Validate required fields based on sheetType
                if (value.sheetType === 'DAILY') {
                    if (!value.workLeaderId || !value.workDate) {
                        return helpers.error('any.required', {
                            message: 'DAILY requires workLeaderId and workDate',
                        });
                    }
                } else if (value.sheetType === 'MONTHLY') {
                    if (!value.employeeId || !value.monthPeriod) {
                        return helpers.error('any.required', {
                            message: 'MONTHLY requires employeeId and monthPeriod',
                        });
                    }
                }
                return value;
            }),
        );

        const userId = req.user?.id; // ดึงจาก auth middleware
        const timeSheet = await timeSheetService.createTimeSheet({
            ...body,
            createBy: userId,
        });

        res.status(201).json({
            success: true,
            data: timeSheet,
        });
    };

    updateTimeSheet = async (req, res) => {
        const { id } = validate(
            req.params,
            Joi.object({
                id: Joi.number().integer().required(),
            }),
        );

        const body = validate(
            req.body,
            Joi.object({
                status: Joi.string().valid('PENDING', 'FILLED', 'LOCKED'),
                files: Joi.array().items(Joi.string()),
            }).min(1),
        );

        const timeSheet = await timeSheetService.updateTimeSheet(id, body);

        res.status(200).json({
            success: true,
            data: timeSheet,
        });
    };

    addFile = async (req, res) => {
        const { id } = validate(
            req.params,
            Joi.object({
                id: Joi.number().integer().required(),
            }),
        );

        const body = validate(
            req.body,
            Joi.object({
                filePath: Joi.string().required(),
            }),
        );

        const timeSheet = await timeSheetService.addFile(id, body.filePath);

        res.status(200).json({
            success: true,
            data: timeSheet,
        });
    };

    removeFile = async (req, res) => {
        const { id, filePath } = validate(
            req.params,
            Joi.object({
                id: Joi.number().integer().required(),
                filePath: Joi.string().required(),
            }),
        );

        // Decode filePath from URL
        const decodedFilePath = decodeURIComponent(filePath);
        const timeSheet = await timeSheetService.removeFile(id, decodedFilePath);

        res.status(200).json({
            success: true,
            data: timeSheet,
        });
    };

    lockTimeSheet = async (req, res) => {
        const { id } = validate(
            req.params,
            Joi.object({
                id: Joi.number().integer().required(),
            }),
        );

        const timeSheet = await timeSheetService.lockTimeSheet(id);

        res.status(200).json({
            success: true,
            data: timeSheet,
        });
    };

    unlockTimeSheet = async (req, res) => {
        const { id } = validate(
            req.params,
            Joi.object({
                id: Joi.number().integer().required(),
            }),
        );

        const timeSheet = await timeSheetService.unlockTimeSheet(id);

        res.status(200).json({
            success: true,
            data: timeSheet,
        });
    };
}

export default new TimeSheetController();

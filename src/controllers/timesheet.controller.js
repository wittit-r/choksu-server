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
                workLeaderId: Joi.number().integer().required(),
                workDate: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
                allowDuplicate: Joi.boolean().default(false),
                pattern: Joi.object({
                    regular: Joi.boolean().required(),
                    ot: Joi.number().integer().min(0).default(0),
                }).required(),
                entries: Joi.array()
                    .items(
                        Joi.object({
                            employeeId: Joi.number().integer().required(),
                            shiftType: Joi.string().valid('regular', 'shift').required(),
                            timeIn: Joi.string().pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).required(),
                            timeOut: Joi.string().pattern(/^([01]?[0-9]|2[0-4]):[0-5][0-9]$/).required(),
                        })
                    )
                    .min(1)
                    .required(),
            }).custom((value, helpers) => {
                // Validate timeIn < timeOut for each entry
                for (const entry of value.entries) {
                    // แปลงเป็นตัวเลขเพื่อเปรียบเทียบ (24:00 → 2400)
                    const timeInNum = parseInt(entry.timeIn.replace(':', ''), 10);
                    const timeOutNum = parseInt(entry.timeOut.replace(':', ''), 10);
                    
                    if (timeInNum >= timeOutNum) {
                        return helpers.error('any.invalid', {
                            message: `timeIn (${entry.timeIn}) ต้องน้อยกว่า timeOut (${entry.timeOut}) สำหรับพนักงาน ${entry.employeeId}`,
                        });
                    }
                }
                return value;
            }),
        );

        const userId = req.user?.userId;
        const timeSheet = await timeSheetService.createTimeSheetWithEntries({
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
                entries: Joi.object({
                    add: Joi.array().items(
                        Joi.object({
                            employeeId: Joi.number().integer().required(),
                            shiftType: Joi.string().valid('regular', 'shift').required(),
                            timeIn: Joi.string().pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).required(),
                            timeOut: Joi.string().pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).required(),
                        })
                    ),
                    update: Joi.array().items(
                        Joi.object({
                            id: Joi.number().integer().required(),
                            timeIn: Joi.string().pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/),
                            timeOut: Joi.string().pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/),
                            shiftType: Joi.string().valid('regular', 'shift'),
                        }).min(1)
                    ),
                    delete: Joi.array().items(Joi.number().integer()),
                }).min(1),
            })
                .min(1)
                .custom((value, helpers) => {
                    // Validate timeIn < timeOut for add entries
                    if (value.entries?.add) {
                        for (const entry of value.entries.add) {
                            if (entry.timeIn >= entry.timeOut) {
                                return helpers.error('any.invalid', {
                                    message: `timeIn must be before timeOut for employee ${entry.employeeId}`,
                                });
                            }
                        }
                    }
                    // Validate timeIn < timeOut for update entries
                    if (value.entries?.update) {
                        for (const entry of value.entries.update) {
                            if (entry.timeIn && entry.timeOut && entry.timeIn >= entry.timeOut) {
                                return helpers.error('any.invalid', {
                                    message: `timeIn must be before timeOut for entry ${entry.id}`,
                                });
                            }
                        }
                    }
                    return value;
                }),
        );

        // Use new method if entries operations are present
        if (body.entries) {
            const timeSheet = await timeSheetService.updateTimeSheetWithEntries(id, body);
            return res.status(200).json({
                success: true,
                data: timeSheet,
            });
        }

        // Use original method for simple updates
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

import { validate, Joi } from "../utils/validate.js";
import timeSheetService from "../services/timesheet.service.js";

/**
 * Custom validation for workType rules:
 * - REGULAR: otRate=0, accommodation=0, requires timeIn/timeOut
 * - OVERTIME: otRate>0, accommodation=0, requires timeIn/timeOut
 * - ACCOMMODATION: otRate=0, accommodation>0, NO timeIn/timeOut
 */
const validateWorkTypeRules = (value, helpers) => {
    const { workType, otRate, accommodation, timeIn, timeOut } = value;

    const hasTime = timeIn != null && timeOut != null;

    if (workType === 'REGULAR' || workType === undefined) {
        if (otRate !== undefined && otRate !== 0) {
            return helpers.error('any.invalid', { message: 'REGULAR: otRate ต้องเป็น 0' });
        }
        if (accommodation !== undefined && accommodation !== 0) {
            return helpers.error('any.invalid', { message: 'REGULAR: accommodation ต้องเป็น 0' });
        }
        if (!hasTime) {
            return helpers.error('any.invalid', { message: 'REGULAR: ต้องระบุ timeIn และ timeOut' });
        }
    }

    if (workType === 'OVERTIME') {
        if (otRate === undefined || otRate <= 0) {
            return helpers.error('any.invalid', { message: 'OVERTIME: otRate ต้องมากกว่า 0' });
        }
        if (accommodation !== undefined && accommodation !== 0) {
            return helpers.error('any.invalid', { message: 'OVERTIME: accommodation ต้องเป็น 0' });
        }
        if (!hasTime) {
            return helpers.error('any.invalid', { message: 'OVERTIME: ต้องระบุ timeIn และ timeOut' });
        }
    }

    if (workType === 'ACCOMMODATION') {
        if (otRate !== undefined && otRate !== 0) {
            return helpers.error('any.invalid', { message: 'ACCOMMODATION: otRate ต้องเป็น 0' });
        }
        if (accommodation === undefined || accommodation <= 0) {
            return helpers.error('any.invalid', { message: 'ACCOMMODATION: accommodation ต้องมากกว่า 0' });
        }
        if (hasTime) {
            return helpers.error('any.invalid', { message: 'ACCOMMODATION: ไม่ต้องระบุ timeIn และ timeOut' });
        }
    }

    // timeIn < timeOut validation
    if (hasTime) {
        // แปลง HH:mm:ss เป็นตัวเลขเพื่อเปรียบเทียบ (เช่น 08:00:00 → 080000)
        const timeInNum = timeIn.replace(/:/g, '');
        const timeOutNum = timeOut.replace(/:/g, '');
        if (timeInNum >= timeOutNum) {
            return helpers.error('any.invalid', { message: 'timeIn ต้องน้อยกว่า timeOut' });
        }
    }

    return value;
};

/**
 * Validate timeIn < timeOut
 */
const validateTimeOrder = (value, helpers) => {
    const { timeIn, timeOut } = value;
    if (timeIn && timeOut) {
        const timeInNum = timeIn.replace(/:/g, '');
        const timeOutNum = timeOut.replace(/:/g, '');
        if (timeInNum >= timeOutNum) {
            return helpers.error('any.invalid', { message: 'timeIn ต้องน้อยกว่า timeOut' });
        }
    }
    return value;
};

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
                startDate: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/),
                endDate: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/),
                page: Joi.number().integer().default(1),
                limit: Joi.number().integer().default(10),
                sort: Joi.string().valid('asc', 'desc').default('desc'),
                sortBy: Joi.string().valid('workDate', 'monthPeriod', 'createdAt').default('createdAt'),
            }).and('startDate', 'endDate'),
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

    /**
     * Update TimeSheet status only
     * PATCH /timesheets/:id
     */
    updateTimeSheet = async (req, res) => {
        const { id } = validate(
            req.params,
            Joi.object({
                id: Joi.number().integer().required(),
            }),
        );

        const { status } = validate(
            req.body,
            Joi.object({
                status: Joi.string().valid('PENDING', 'FILLED', 'LOCKED').required(),
            }),
        );

        const timeSheet = await timeSheetService.updateTimeSheetStatus(id, status);

        res.status(200).json({
            success: true,
            data: timeSheet,
        });
    };

    /**
     * Delete TimeSheet (PENDING only)
     * DELETE /timesheets/:id
     */
    deleteTimeSheet = async (req, res) => {
        const { id } = validate(
            req.params,
            Joi.object({
                id: Joi.number().integer().required(),
            }),
        );

        //TODO - ควร soft delete แทนไหม ?

        await timeSheetService.deleteTimeSheet(id);

        res.status(204).send();
    };

    // ============================================
    // Worker TimeEntry Methods (DAILY timesheet only)
    // ============================================

    /**
     * Create Worker TimeEntry
     * POST /timesheets/:id/time-entries/worker
     * - ใช้ pattern จาก entry แรกใน timesheet อัตโนมัติ
     * - ไม่ต้องระบุ workType, otRate
     */
    createWorkerTimeEntry = async (req, res) => {
        const { id } = validate(
            req.params,
            Joi.object({
                id: Joi.number().integer().required(),
            }),
        );

        const body = validate(
            req.body,
            Joi.object({
                employeeId: Joi.number().integer().required(),
                timeIn: Joi.time().required(),
                timeOut: Joi.time().required(),
                shiftType: Joi.string().valid('REGULAR', 'SHIFT').default('REGULAR'),
                note: Joi.string().allow(null),
            }).custom(validateTimeOrder),
        );

        const entry = await timeSheetService.createWorkerTimeEntry(id, body);

        res.status(201).json({
            success: true,
            data: entry,
        });
    };

    /**
     * Update Worker TimeEntry
     * PATCH /timesheets/:id/time-entries/:entryId/worker
     * - แก้ไขได้แค่ timeIn, timeOut, note
     * - ห้ามเปลี่ยน workType, otRate
     */
    updateWorkerTimeEntry = async (req, res) => {
        const { id, entryId } = validate(
            req.params,
            Joi.object({
                id: Joi.number().integer().required(),
                entryId: Joi.number().integer().required(),
            }),
        );

        const body = validate(
            req.body,
            Joi.object({
                timeIn: Joi.time().required(),
                timeOut: Joi.time().required(),
                shiftType: Joi.string().valid('REGULAR', 'SHIFT').required(),
                note: Joi.string().allow(null),
            }).min(1).custom(validateTimeOrder),
        );

        const entry = await timeSheetService.updateWorkerTimeEntry(id, entryId, body);

        res.status(200).json({
            success: true,
            data: entry,
        });
    };

    // ============================================
    // Driver TimeEntry Methods (MONTHLY timesheet only)
    // ============================================

    /**
     * Create Driver TimeEntry
     * POST /timesheets/:id/time-entries/driver
     * - ระบุ workType, otRate, accommodation เองได้
     */
    createDriverTimeEntry = async (req, res) => {
        const { id } = validate(
            req.params,
            Joi.object({
                id: Joi.number().integer().required(),
            }),
        );

        const body = validate(
            req.body,
            Joi.object({
                date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
                timeIn: Joi.time().allow(null),
                timeOut: Joi.time().allow(null),
                workType: Joi.string().valid('REGULAR', 'OVERTIME', 'ACCOMMODATION').required(),
                otRate: Joi.number().min(0).default(0),
                accommodation: Joi.number().min(0).default(0),
                note: Joi.string().allow(null),
            }).custom(validateWorkTypeRules),
        );

        const entry = await timeSheetService.createDriverTimeEntry(id, body);

        res.status(201).json({
            success: true,
            data: entry,
        });
    };

    /**
     * Update Driver TimeEntry
     * PATCH /timesheets/:id/time-entries/:entryId/driver
     * - แก้ไข timeIn, timeOut, otRate, accommodation, note ได้
     * - ห้ามเปลี่ยน workType
     */
    updateDriverTimeEntry = async (req, res) => {
        const { id, entryId } = validate(
            req.params,
            Joi.object({
                id: Joi.number().integer().required(),
                entryId: Joi.number().integer().required(),
            }),
        );

        const body = validate(
            req.body,
            Joi.object({
                timeIn: Joi.time().allow(null),
                timeOut: Joi.time().allow(null),
                otRate: Joi.number().min(0),
                accommodation: Joi.number().min(0),
                note: Joi.string().allow(null),
            }).min(1).custom(validateTimeOrder),
        );

        const entry = await timeSheetService.updateDriverTimeEntry(id, entryId, body);

        res.status(200).json({
            success: true,
            data: entry,
        });
    };

    /**
     * Delete single TimeEntry
     * DELETE /timesheets/:id/time-entries/:entryId
     */
    deleteTimeEntry = async (req, res) => {
        const { id, entryId } = validate(
            req.params,
            Joi.object({
                id: Joi.number().integer().required(),
                entryId: Joi.number().integer().required(),
            }),
        );

        await timeSheetService.deleteTimeEntry(id, entryId);

        res.status(204).send();
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

    /**
     * Create Worker TimeSheet (Daily)
     * POST /timesheets/worker
     */
    createWorkerTimeSheet = async (req, res) => {
        const body = validate(
            req.body,
            Joi.object({
                workLeaderId: Joi.number().integer().required(),
                workDate: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
                allowDuplicate: Joi.boolean().default(false),
                pattern: Joi.object({
                    regular: Joi.boolean().default(true),
                    ot: Joi.number().valid(0, 1, 1.5, 2, 3).default(0),
                }).required(),
                entries: Joi.array()
                    .items(
                        Joi.object({
                            employeeId: Joi.number().integer().required(),
                            timeIn: Joi.time().required(),
                            timeOut: Joi.time().required(),
                            shiftType: Joi.string().valid('regular', 'shift').default('regular'),
                        })
                    )
                    .min(1)
                    .required(),
            }).custom((value, helpers) => {
                // Validate timeIn < timeOut for each entry
                for (const entry of value.entries) {
                    // แปลง HH:mm:ss เป็นตัวเลขเพื่อเปรียบเทียบ
                    const timeInNum = entry.timeIn.replace(/:/g, '');
                    const timeOutNum = entry.timeOut.replace(/:/g, '');
                    if (timeInNum >= timeOutNum) {
                        return helpers.error('any.invalid', {
                            message: `timeIn (${entry.timeIn}) ต้องน้อยกว่า timeOut (${entry.timeOut}) สำหรับพนักงาน ${entry.employeeId}`,
                        });
                    }
                }
                return value;
            }),
        );

        const result = await timeSheetService.createWorkerTimeSheet({
            ...body,
            createBy: req.user?.userId,
        });

        res.status(201).json({
            success: true,
            data: result,
        });
    };

    /**
     * Create Driver TimeSheet (Monthly)
     * POST /timesheets/driver
     */
    createDriverTimeSheet = async (req, res) => {
        const body = validate(
            req.body,
            Joi.object({
                employeeId: Joi.number().integer().required(),
                monthPeriod: Joi.string().pattern(/^\d{4}-\d{2}$/).required(),
                allowDuplicate: Joi.boolean().default(false),
                entries: Joi.array()
                    .items(
                        Joi.object({
                            date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
                            timeIn: Joi.time().allow(null),
                            timeOut: Joi.time().allow(null),
                            workType: Joi.string().valid('REGULAR', 'OVERTIME', 'ACCOMMODATION').required(),
                            otRate: Joi.number().min(0).default(0),
                            accommodation: Joi.number().min(0).default(0),
                        })
                            .custom(validateWorkTypeRules),
                    )
                    .min(1)
                    .required(),
            })
        );

        const result = await timeSheetService.createDriverTimeSheet({
            ...body,
            createBy: req.user?.userId,
        });

        res.status(201).json({
            success: true,
            data: result,
        });
    };

    /**
     * Create Correction TimeEntry (Negative Entry)
     * POST /timesheets/:id/time-entries/correction
     */
    createCorrectionTimeEntry = async (req, res) => {
        const { id } = validate(
            req.params,
            Joi.object({
                id: Joi.number().integer().required(),
            }),
        );

        const body = validate(
            req.body,
            Joi.object({
                originalEntryId: Joi.number().integer().required(),
                timeIn: Joi.time().required(),
                timeOut: Joi.time().required(),
                note: Joi.string().allow(null),
            }).custom(validateTimeOrder),
        );

        const entry = await timeSheetService.createCorrectionTimeEntry(id, {
            ...body,
            createBy: req.user?.userId,
        });

        res.status(201).json({
            success: true,
            data: entry,
        });
    };

}

export default new TimeSheetController();

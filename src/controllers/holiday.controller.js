import { validate, Joi } from "../utils/validate.js";
import holidayService from "../services/holiday.service.js";

class HolidayController {
    getHolidays = async (req, res) => {
        const query = validate(
            req.query,
            Joi.object({
                year: Joi.number().integer().min(1900).max(3000),
            }),
        );

        const data = await holidayService.getHolidays(query);

        res.status(200).json({ success: true, data });
    };

    createHoliday = async (req, res) => {
        const body = validate(
            req.body,
            Joi.object({
                date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
                name: Joi.string().required(),
            }),
        );

        const data = await holidayService.createHoliday(body);

        res.status(201).json({ success: true, data });
    };

    deleteHoliday = async (req, res) => {
        const { id } = validate(
            req.params,
            Joi.object({
                id: Joi.number().integer().required(),
            }),
        );

        await holidayService.deleteHoliday({ id });

        res.status(200).json({ success: true });
    };
}

export default new HolidayController();

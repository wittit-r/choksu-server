import express from "express";
import { auth } from "../middlewares/auth.js";
import holidayController from "../controllers/holiday.controller.js";

const router = express.Router();

/**
 * /holidays — ปฏิทินวันหยุดนักขัตฤกษ์
 */
router.get("/", auth, holidayController.getHolidays);
router.post("/", auth, holidayController.createHoliday);
router.delete("/:id", auth, holidayController.deleteHoliday);

export default router;

import express from "express";
import { auth } from "../middlewares/auth.js";
import timeSheetController from "../controllers/timesheet.controller.js";

const router = express.Router();

/**
 * /timesheets
 */
router.get("/", auth, timeSheetController.getTimeSheets);
router.post("/worker", auth, timeSheetController.createWorkerTimeSheet);
router.post("/driver", auth, timeSheetController.createDriverTimeSheet);
router.get("/:id", auth, timeSheetController.getTimeSheetById);
router.patch("/:id", auth, timeSheetController.updateTimeSheet);
router.delete("/:id", auth, timeSheetController.deleteTimeSheet);

// Worker TimeEntry (DAILY timesheet only)
router.post("/:id/time-entries/worker", auth, timeSheetController.createWorkerTimeEntry);
router.patch("/:id/time-entries/:entryId/worker", auth, timeSheetController.updateWorkerTimeEntry);

// Driver TimeEntry (MONTHLY timesheet only)
router.post("/:id/time-entries/driver", auth, timeSheetController.createDriverTimeEntry);
router.patch("/:id/time-entries/:entryId/driver", auth, timeSheetController.updateDriverTimeEntry);

// Delete (ใช้ร่วมกันได้)
router.delete("/:id/time-entries/:entryId", auth, timeSheetController.deleteTimeEntry);

// Correction TimeEntry (แก้ไขย้อนหลัง)
router.post("/:id/time-entries/correction", auth, timeSheetController.createCorrectionTimeEntry);

// File management
router.post("/:id/files", auth, timeSheetController.addFile);
router.delete("/:id/files/:filePath", auth, timeSheetController.removeFile);

export default router;

import express from "express";
import { wrap } from "../middlewares/errorHandler.js";
import { auth } from "../middlewares/auth.js";
import timeSheetController from "../controllers/timesheet.controller.js";

const router = express.Router();

/**
 * /timesheets
 */
router.get("/", auth, wrap(timeSheetController.getTimeSheets));
router.post("/", auth, wrap(timeSheetController.createTimeSheet));
router.get("/:id", auth, wrap(timeSheetController.getTimeSheetById));
router.patch("/:id", auth, wrap(timeSheetController.updateTimeSheet));

// File management
router.post("/:id/files", auth, wrap(timeSheetController.addFile));
router.delete("/:id/files/:filePath", auth, wrap(timeSheetController.removeFile));

// Lock/Unlock
router.post("/:id/lock", auth, wrap(timeSheetController.lockTimeSheet));
router.post("/:id/unlock", auth, wrap(timeSheetController.unlockTimeSheet));

export default router;

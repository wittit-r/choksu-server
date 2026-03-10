import express from "express";
import { wrap } from "../middlewares/errorHandler.js";
import { auth } from "../middlewares/auth.js";
import timeSheetController from "../controllers/timesheet.controller.js";

const router = express.Router();

/**
 * /timesheets
 */
router.get("/", auth, wrap(timeSheetController.getTimeSheets));
router.post("/worker", auth, wrap(timeSheetController.createWorkerTimeSheet));
router.post("/driver", auth, wrap(timeSheetController.createDriverTimeSheet));
router.get("/:id", auth, wrap(timeSheetController.getTimeSheetById));
router.patch("/:id", auth, wrap(timeSheetController.updateTimeSheet));
router.delete("/:id", auth, wrap(timeSheetController.deleteTimeSheet));

// Worker TimeEntry (DAILY timesheet only)
router.post("/:id/time-entries/worker", auth, wrap(timeSheetController.createWorkerTimeEntry));
router.patch("/:id/time-entries/:entryId/worker", auth, wrap(timeSheetController.updateWorkerTimeEntry));

// Driver TimeEntry (MONTHLY timesheet only)
router.post("/:id/time-entries/driver", auth, wrap(timeSheetController.createDriverTimeEntry));
router.patch("/:id/time-entries/:entryId/driver", auth, wrap(timeSheetController.updateDriverTimeEntry));

// Delete (ใช้ร่วมกันได้)
router.delete("/:id/time-entries/:entryId", auth, wrap(timeSheetController.deleteTimeEntry));

// File management
router.post("/:id/files", auth, wrap(timeSheetController.addFile));
router.delete("/:id/files/:filePath", auth, wrap(timeSheetController.removeFile));

export default router;

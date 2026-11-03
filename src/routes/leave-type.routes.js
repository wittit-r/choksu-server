import express from "express";
import { auth } from "../middlewares/auth.js";
import leaveTypeController from "../controllers/leave-type.controller.js";

const router = express.Router();

/**
 * /leave-types — ชนิดวันลา (master)
 */
router.get("/", auth, leaveTypeController.getLeaveTypes);
router.get("/:id", auth, leaveTypeController.getLeaveTypeById);
router.post("/", auth, leaveTypeController.createLeaveType);
router.patch("/:id", auth, leaveTypeController.updateLeaveType);
router.delete("/:id", auth, leaveTypeController.deleteLeaveType);

export default router;

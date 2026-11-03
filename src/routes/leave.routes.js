import express from "express";
import { auth } from "../middlewares/auth.js";
import leaveController from "../controllers/leave.controller.js";

const router = express.Router();

/**
 * /leaves — บันทึกวันลา
 */
router.get("/", auth, leaveController.getLeaves);
router.get("/:id", auth, leaveController.getLeaveById);
router.post("/", auth, leaveController.createLeave);
router.delete("/:id", auth, leaveController.deleteLeave);

export default router;

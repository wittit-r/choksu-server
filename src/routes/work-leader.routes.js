import express from "express";
import { wrap } from "../middlewares/errorHandler.js";
import { auth } from "../middlewares/auth.js";
import workLeaderController from "../controllers/work-leader.controller.js";

const router = express.Router();

/**
 * /work-leaders
 */
router.get("/", auth, wrap(workLeaderController.getWorkLeaders));
router.post("/", auth, wrap(workLeaderController.createWorkLeader));
router.patch("/:id", auth, wrap(workLeaderController.updateWorkLeader));

export default router;

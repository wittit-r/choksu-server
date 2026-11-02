import express from "express";
import { auth } from "../middlewares/auth.js";
import workLeaderController from "../controllers/work-leader.controller.js";

const router = express.Router();

/**
 * /work-leaders
 */
router.get("/", auth, workLeaderController.getWorkLeaders);
router.get("/:id", auth, workLeaderController.getWorkLeaderById);
router.post("/", auth, workLeaderController.createWorkLeader);
router.patch("/:id", auth, workLeaderController.updateWorkLeader);

export default router;

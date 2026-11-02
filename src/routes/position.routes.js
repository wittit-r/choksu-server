import express from "express";
import { auth } from "../middlewares/auth.js";
import positionController from "../controllers/position.controller.js";

const router = express.Router();

/**
 * /positions
 */
router.get("/", auth, positionController.getPositions);
router.get("/:id", auth, positionController.getPositionById);
router.post("/", auth, positionController.createPosition);
router.patch("/:id", auth, positionController.updatePosition);

export default router;

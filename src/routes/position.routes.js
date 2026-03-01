import express from "express";
import { wrap } from "../middlewares/errorHandler.js";
import { auth } from "../middlewares/auth.js";
import positionController from "../controllers/position.controller.js";

const router = express.Router();

/**
 * /positions
 */
router.get("/", auth, wrap(positionController.getPositions));
router.get("/:id", auth, wrap(positionController.getPositionById));
router.post("/", auth, wrap(positionController.createPosition));
router.patch("/:id", auth, wrap(positionController.updatePosition));

export default router;

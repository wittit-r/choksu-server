import express from "express";
import { wrap } from "../middlewares/errorHandler.js";
import { auth, authorize } from "../middlewares/auth.js";
import userController from "../controllers/user.controller.js";

const router = express.Router();

/**
 * /users
 */
router.get("/", auth, authorize('SUPER_ADMIN', 'SENOIR_ACCOUNTING'), wrap(userController.getUsers));
router.post("/", auth, authorize('SUPER_ADMIN'), wrap(userController.createUser));
router.get("/:id", auth, wrap(userController.getUserById));
router.patch("/:id", auth, authorize('SUPER_ADMIN'), wrap(userController.updateUser));

export default router;

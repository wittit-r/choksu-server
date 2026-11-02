import express from "express";
import { auth, authorize } from "../middlewares/auth.js";
import userController from "../controllers/user.controller.js";

const router = express.Router();

/**
 * /users
 */
router.get("/", auth, authorize('SUPER_ADMIN', 'SENOIR_ACCOUNTING'), userController.getUsers);
router.post("/", auth, authorize('SUPER_ADMIN'), userController.createUser);
router.get("/:id", auth, userController.getUserById);
router.patch("/:id", auth, authorize('SUPER_ADMIN'), userController.updateUser);

export default router;

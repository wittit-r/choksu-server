import express from "express";
import { wrap } from "../middlewares/errorHandler.js";
import authController from "../controllers/auth.controller.js";
import { auth, authorize } from "../middlewares/auth.js";

const router = express.Router();

/**
 * Public Routes (ไม่ต้องล็อกอิน)
 */
router.post("/login", wrap(authController.login));
router.post("/refresh", wrap(authController.refreshAccessToken));

/**
 * Protected Routes (ต้องล็อกอิน)
 */
router.post("/logout", auth, wrap(authController.logout));

/**
 * Additional Routes (Optional - สำหรับดึงข้อมูล user ปัจจุบัน)
 */
router.get("/me", auth, wrap(async (req, res) => {
    res.status(200).json({
        status: "success",
        data: req.user
    });
}));

export default router;

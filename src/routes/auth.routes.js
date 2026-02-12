import express from "express";
import { wrap } from "../middlewares/errorHandler.js";
import authController from "../controllers/auth.controller.js";
import { auth } from "../middlewares/auth.js";

const router = express.Router();

/**
 * /auth
 */
router.post("/login", wrap(authController.login));
router.post("/refresh", wrap(authController.refreshAccessToken));
router.post("/logout", auth, wrap(authController.logout));

/**
 * Additional Routes (Optional - สำหรับดึงข้อมูล user ปัจจุบัน)
 */
router.get("/me", auth, wrap(async (req, res) => {
    res.status(200).json({
        success: true,
        data: req.user
    });
}));

export default router;

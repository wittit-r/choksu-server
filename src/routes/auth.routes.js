import express from "express";
import authController from "../controllers/auth.controller.js";
import { auth } from "../middlewares/auth.js";

const router = express.Router();

/**
 * /auth
 */
router.post("/login", authController.login);
router.post("/refresh", authController.refreshAccessToken);
router.post("/logout", auth, authController.logout);

/**
 * Additional Routes (Optional - สำหรับดึงข้อมูล user ปัจจุบัน)
 */
router.get("/me", auth, async (req, res) => {
    res.status(200).json({
        success: true,
        data: req.user
    });
});

export default router;

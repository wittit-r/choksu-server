import express from "express";
import authRoutes from "./auth.routes.js";
import employeeRoutes from "./employee.routes.js";
import userRoutes from "./user.routes.js";

const router = express.Router();

// Auth routes
router.use('/auth', authRoutes);

// Employee routes
router.use('/employees', employeeRoutes);

// User routes
router.use('/users', userRoutes);

export default router;
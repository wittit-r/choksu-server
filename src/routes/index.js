import express from "express";
import authRoutes from "./auth.routes.js";
import employeeRoutes from "./employee.routes.js";

const router = express.Router();

// Auth routes
router.use('/auth', authRoutes);

// Employee routes
router.use('/employees', employeeRoutes);

export default router;
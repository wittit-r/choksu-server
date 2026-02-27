import express from "express";
import authRoutes from "./auth.routes.js";
import employeeRoutes from "./employee.routes.js";
import userRoutes from "./user.routes.js";
import positionRoutes from "./position.routes.js";
import workLeaderRoutes from "./work-leader.routes.js";
import branchRoutes from "./branch.routes.js";

const router = express.Router();

// Auth routes
router.use('/auth', authRoutes);

// Employee routes
router.use('/employees', employeeRoutes);

// User routes
router.use('/users', userRoutes);

// Position routes
router.use('/positions', positionRoutes);

// Work Leader routes
router.use('/work-leaders', workLeaderRoutes);

// Branch routes
router.use('/branches', branchRoutes);

export default router;
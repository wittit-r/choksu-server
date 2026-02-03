import express from "express";
import { wrap } from "../middlewares/errorHandler.js";
import { auth } from "../middlewares/auth.js";
import employeeController from "../controllers/employee.controller.js";
import authRoutes from "./auth.routes.js";

const router = express.Router();

// Auth routes
router.use('/auth', authRoutes);

router.get("/employees", auth, wrap(employeeController.getEmployees));
router.post("/employees", auth, wrap(employeeController.createEmployee));
router.post("/employees/:employeeId/users", auth, wrap(employeeController.createUser));

export default router;
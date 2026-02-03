import express from "express";
import { wrap } from "../middlewares/errorHandler.js";
import employeeController from "../controllers/employee.controller.js";
import authRoutes from "./auth.routes.js";

const router = express.Router();

// Auth routes
router.use('/auth', authRoutes);

router.get("/employees", wrap(employeeController.getEmployees));
router.post("/employees", wrap(employeeController.createEmployee));

export default router;
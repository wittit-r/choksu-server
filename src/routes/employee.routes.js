import express from "express";
import { wrap } from "../middlewares/errorHandler.js";
import { auth } from "../middlewares/auth.js";
import employeeController from "../controllers/employee.controller.js";

const router = express.Router();

/**
 * /employees
 */
router.get("/", auth, wrap(employeeController.getEmployees));
router.post("/", auth, wrap(employeeController.createEmployee));
router.post("/retro-calculate", auth, wrap(employeeController.calculateRetroactive));
router.get("/:id", auth, wrap(employeeController.getEmployeeById));
router.patch("/:id", auth, wrap(employeeController.updateEmployee));

// Wage routes (nested under employee)
router.get("/:employeeId/wages", auth, wrap(employeeController.getWages));
router.post("/:employeeId/wages", auth, wrap(employeeController.createWage));
router.patch("/:employeeId/wages/:id", auth, wrap(employeeController.updateWage));

// Time attendance routes
router.get("/:employeeId/time-entries", auth, wrap(employeeController.getTimeEntries));

export default router;

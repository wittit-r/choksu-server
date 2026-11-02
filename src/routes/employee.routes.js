import express from "express";
import { auth } from "../middlewares/auth.js";
import employeeController from "../controllers/employee.controller.js";

const router = express.Router();

/**
 * /employees
 */
router.get("/", auth, employeeController.getEmployees);
router.post("/", auth, employeeController.createEmployee);
router.post("/retro-calculate", auth, employeeController.calculateRetroactive);
router.get("/:id", auth, employeeController.getEmployeeById);
router.patch("/:id", auth, employeeController.updateEmployee);

// Wage routes (nested under employee)
router.get("/:employeeId/wages", auth, employeeController.getWages);
router.post("/:employeeId/wages", auth, employeeController.createWage);
router.patch("/:employeeId/wages/:id", auth, employeeController.updateWage);

// Time attendance routes
router.get("/:employeeId/time-entries", auth, employeeController.getTimeEntries);

export default router;

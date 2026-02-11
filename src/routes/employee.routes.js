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
router.get("/:id", auth, wrap(employeeController.getEmployeeById));
router.patch("/:id", auth, wrap(employeeController.updateEmployee));

/**
 * /employees/:id/users
 */
router.get("/:id/users", auth, wrap(employeeController.getEmployeeUsers));
router.get("/:id/users/:userId", auth, wrap(employeeController.getEmployeeUserById));
router.post("/:id/users", auth, wrap(employeeController.createEmployeeUser));
router.patch("/:id/users/:userId", auth, wrap(employeeController.updateEmployeeUser));

export default router;

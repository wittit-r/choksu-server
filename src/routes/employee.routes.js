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

export default router;

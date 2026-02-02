import express from "express";
import { wrap } from "../middlewares/errorHandler.js";
import employeeController from "../controllers/employee.controller.js";

const router = express.Router();

router.get("/employees", wrap(employeeController.getEmployees));
router.post("/employees", wrap(employeeController.createEmployee));

export default router;
import express from "express";
import { wrap } from "../middlewares/errorHandler.js";
import { auth } from "../middlewares/auth.js";
import payrollController from "../controllers/payroll.controller.js";

const router = express.Router();

router.get("/", auth, wrap(payrollController.getPayrolls));
router.post("/retro-calculate", auth, wrap(payrollController.calculateRetroactive));
router.get("/:id", auth, wrap(payrollController.getPayrollById));
router.patch("/:id", auth, wrap(payrollController.updatePayroll));
router.patch("/:id/recalculate", auth, wrap(payrollController.recalculatePayroll));
router.delete("/:id", auth, wrap(payrollController.cancelPayroll));

export default router;

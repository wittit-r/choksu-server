import express from "express";
import { auth } from "../middlewares/auth.js";
import payrollController from "../controllers/payroll.controller.js";

const router = express.Router();

router.get("/", auth, payrollController.getPayrolls);
router.post("/retro-calculate", auth, payrollController.calculateRetroactive);
router.get("/:id", auth, payrollController.getPayrollById);
router.patch("/:id", auth, payrollController.updatePayroll);
router.patch("/:id/recalculate", auth, payrollController.recalculatePayroll);
router.delete("/:id", auth, payrollController.cancelPayroll);

export default router;

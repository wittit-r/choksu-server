import express from "express";
import { auth } from "../middlewares/auth.js";
import payPeriodController from "../controllers/pay-period.controller.js";

const router = express.Router();

router.get("/", auth, payPeriodController.getPayPeriods);
router.get("/:id", auth, payPeriodController.getPayPeriodById);
router.post("/", auth, payPeriodController.createPayPeriod);
router.post("/:id/payrolls", auth, payPeriodController.createPayrolls);
router.delete("/:id/payrolls", auth, payPeriodController.cancelAllPayrolls);
router.patch("/:id/recalculate", auth, payPeriodController.recalculatePayPeriod);
router.post("/:id/export", auth, payPeriodController.exportPayPeriod);
router.patch("/:id/close", auth, payPeriodController.closePayPeriod);
router.patch("/:id/reopen", auth, payPeriodController.reopenPayPeriod);
router.post("/:id/import", auth, payPeriodController.importBankFile);
export default router;

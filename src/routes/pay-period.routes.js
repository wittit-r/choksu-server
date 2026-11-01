import express from "express";
import { wrap } from "../middlewares/errorHandler.js";
import { auth } from "../middlewares/auth.js";
import payPeriodController from "../controllers/pay-period.controller.js";

const router = express.Router();

router.get("/", auth, wrap(payPeriodController.getPayPeriods));
router.get("/:id", auth, wrap(payPeriodController.getPayPeriodById));
router.post("/", auth, wrap(payPeriodController.createPayPeriod));
router.post("/:id/payrolls", auth, wrap(payPeriodController.createPayrolls));
router.delete("/:id/payrolls", auth, wrap(payPeriodController.cancelAllPayrolls));
router.patch("/:id/recalculate", auth, wrap(payPeriodController.recalculatePayPeriod));
router.post("/:id/export", auth, wrap(payPeriodController.exportPayPeriod));
router.patch("/:id/close", auth, wrap(payPeriodController.closePayPeriod));
router.patch("/:id/reopen", auth, wrap(payPeriodController.reopenPayPeriod));
router.post("/:id/import", auth, wrap(payPeriodController.importBankFile));
export default router;

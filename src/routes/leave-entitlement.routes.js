import express from "express";
import { auth } from "../middlewares/auth.js";
import leaveEntitlementController from "../controllers/leave-entitlement.controller.js";

const router = express.Router();

/**
 * /leave-entitlements — สิทธิ์วันลารายคน (ต่อปี)
 */
router.get("/", auth, leaveEntitlementController.getEntitlements);
router.patch("/:id", auth, leaveEntitlementController.updateEntitlement);
router.post("/generate", auth, leaveEntitlementController.generateEntitlements);

export default router;

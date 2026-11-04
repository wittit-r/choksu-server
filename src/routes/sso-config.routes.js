import express from "express";
import { auth } from "../middlewares/auth.js";
import ssoConfigController from "../controllers/sso-config.controller.js";

const router = express.Router();

/**
 * /sso-configs — เงื่อนไขประกันสังคมตามช่วงเวลา (rate + เพดานค่าจ้าง)
 */
router.get("/", auth, ssoConfigController.getSsoConfigs);
router.post("/", auth, ssoConfigController.createSsoConfig);
router.get("/report", auth, ssoConfigController.getSsoReport);
router.get("/report/export", auth, ssoConfigController.exportSsoReport);
router.patch("/:id", auth, ssoConfigController.updateSsoConfig);
router.delete("/:id", auth, ssoConfigController.deleteSsoConfig);

export default router;

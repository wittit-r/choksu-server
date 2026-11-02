import express from "express";
import { auth } from "../middlewares/auth.js";
import branchController from "../controllers/branch.controller.js";

const router = express.Router();

/**
 * /branches
 */
router.get("/", auth, branchController.getBranches);
router.get("/:id", auth, branchController.getBranchById);
router.post("/", auth, branchController.createBranch);
router.patch("/:id", auth, branchController.updateBranch);

export default router;

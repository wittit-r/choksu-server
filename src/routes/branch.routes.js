import express from "express";
import { wrap } from "../middlewares/errorHandler.js";
import { auth } from "../middlewares/auth.js";
import branchController from "../controllers/branch.controller.js";

const router = express.Router();

/**
 * /branches
 */
router.get("/", auth, wrap(branchController.getBranches));
router.get("/:id", auth, wrap(branchController.getBranchById));
router.post("/", auth, wrap(branchController.createBranch));
router.patch("/:id", auth, wrap(branchController.updateBranch));

export default router;

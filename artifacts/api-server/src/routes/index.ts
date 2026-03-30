import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import tenantsRouter from "./tenants";
import usersRouter from "./users";
import ticketsRouter from "./tickets";
import documentsRouter from "./documents";
import dashboardRouter from "./dashboard";
import auditRouter from "./audit";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/tenants", tenantsRouter);
router.use("/users", usersRouter);
router.use("/tickets", ticketsRouter);
router.use("/documents", documentsRouter);
router.use("/dashboard", dashboardRouter);
router.use("/audit", auditRouter);

export default router;

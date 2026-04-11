import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import usersRouter from "./users";
import conversationsRouter from "./conversations";
import messagesRouter from "./messages";
import uploadsRouter from "./uploads";
import pollsRouter from "./polls";
import shopProxyRouter from "./shopProxy";
import adminRouter from "./admin";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(usersRouter);
router.use(conversationsRouter);
router.use(messagesRouter);
router.use(uploadsRouter);
router.use(pollsRouter);
router.use(shopProxyRouter);
router.use(adminRouter);

export default router;

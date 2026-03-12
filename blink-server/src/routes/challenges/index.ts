import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import createRouter from './create';
import respondRouter from './respond';
import reactionsRouter from './reactions';
import queriesRouter from './queries';

const router = Router();

router.use(authenticate);

// Mount all sub-routers — order matters for route matching
router.use(createRouter);
router.use(respondRouter);
router.use(reactionsRouter);
router.use(queriesRouter);

export default router;

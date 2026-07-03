import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { getAuditLogs, getAuditActions, getAuditEntities } from '../controllers/auditLog.controller';

const router = Router();

// All audit log routes require authentication and ADMIN+ role
router.use(authenticate, authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'));

router.get('/', getAuditLogs);
router.get('/actions', getAuditActions);
router.get('/entities', getAuditEntities);

export default router;

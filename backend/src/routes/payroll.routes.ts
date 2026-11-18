import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { AuthRequest } from '../types';
import { AppError } from '../utils/errorHandler';
import { getPayroll, getPayrollExpense, reviewPayrollExpense, setHourlyRate, setPayrollSchedule, processPayroll } from '../controllers/payroll.controller';
const router = Router();
router.use(authenticate, authorize('ADMIN'));
// Payroll stays owner-only even if broader authorization policy changes.
router.use((req: AuthRequest, _res, next) => {
  if (req.user?.role !== 'ADMIN') return next(new AppError('Payroll is managed by the store admin', 403));
  next();
});
router.get('/', getPayroll);
router.get('/expenses/:id', getPayrollExpense);
router.post('/expenses/:id/review', reviewPayrollExpense);
router.put('/employees/:id/rate', setHourlyRate);
router.put('/schedule', setPayrollSchedule);
router.post('/process', processPayroll);
export default router;

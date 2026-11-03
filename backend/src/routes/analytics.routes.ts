import { Router } from 'express';
import * as analyticsController from '../controllers/analytics.controller';
import { analyticsChat } from '../controllers/aiChat.controller';
import { authenticate, authorize } from '../middleware/auth';
import { storeAssistantLimiter } from '../services/assistant.service';

const router = Router();

// All routes require authentication
router.use(authenticate);

/**
 * Get comparison analytics (YoY, MoM, WoW)
 */
router.get(
  '/comparison',
  authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'),
  analyticsController.getComparisonAnalytics
);

/**
 * Get ABC inventory analysis
 */
router.get(
  '/abc-analysis',
  authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'),
  analyticsController.getABCAnalysis
);

/**
 * Get product performance matrix
 */
router.get(
  '/product-matrix',
  authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'),
  analyticsController.getProductPerformanceMatrix
);

/**
 * Get sales forecast
 */
router.get(
  '/forecast',
  authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'),
  analyticsController.getSalesForecast
);

/**
 * Get customer insights
 */
router.get(
  '/customer-insights',
  authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'),
  analyticsController.getCustomerInsights
);

/**
 * Get real-time metrics
 */
router.get(
  '/realtime',
  analyticsController.getRealtimeMetrics
);

/**
 * Get inventory predictions and reorder suggestions
 */
router.get(
  '/inventory-predictions',
  authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'),
  analyticsController.getInventoryPredictions
);

/**
 * Get sales anomaly detection
 */
router.get(
  '/anomalies',
  authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'),
  analyticsController.getSalesAnomalies
);

/**
 * Get bundle recommendations
 */
router.get(
  '/bundle-recommendations',
  authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'),
  analyticsController.getBundleRecommendations
);

/**
 * Get employee performance scores and leaderboard
 */
router.get(
  '/employee-performance',
  authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'),
  analyticsController.getEmployeePerformance
);

/**
 * Get business health dashboard
 */
router.get(
  '/business-health',
  authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'),
  analyticsController.getBusinessHealth
);

/**
 * Get what-if scenario analysis
 */
router.post(
  '/what-if',
  authorize('ADMIN', 'MANAGER'),
  analyticsController.getWhatIfAnalysis
);

/**
 * Natural-language analytics chat (Claude tool-use over read-only queries)
 */
router.post(
  '/chat',
  authorize('ADMIN', 'MANAGER'),
  storeAssistantLimiter,
  analyticsChat
);

export default router;

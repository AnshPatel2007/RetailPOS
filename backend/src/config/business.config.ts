/**
 * Business configuration
 * Centralized location for all business logic constants
 */

export const businessConfig = {
  /**
   * Inventory Management
   */
  inventory: {
    // Default low stock alert threshold
    defaultLowStockThreshold: 10,

    // Number of days of inventory to maintain (safety stock calculation)
    safetyStockDays: 7,

    // Reorder point multiplier (days of lead time + safety stock)
    reorderPointDays: 14,
  },

  /**
   * Financial Metrics
   */
  financial: {
    // Default Cost of Goods Sold percentage (60%)
    defaultCOGSPercentage: 0.60,

    // Default profit margin assumption (40%)
    defaultProfitMargin: 0.40,

    // Low margin warning threshold (15%)
    lowMarginThreshold: 0.15,

    // High margin threshold for reporting (50%)
    highMarginThreshold: 0.50,
  },

  /**
   * Sales & Performance
   */
  sales: {
    // Number of top products to show in reports
    topProductsLimit: 10,

    // Number of days for "recent" sales analysis
    recentSalesDays: 30,

    // Minimum transaction amount for discounts
    minDiscountAmount: 0,

    // Maximum discount percentage allowed
    maxDiscountPercentage: 100,
  },

  /**
   * Customer Management
   */
  customer: {
    // Loyalty points per dollar spent
    loyaltyPointsPerDollar: 1,

    // Loyalty points value (e.g., 100 points = $1)
    pointsToDollarRatio: 100,

    // Days of inactivity before customer is considered inactive
    inactiveDays: 365,

    // Loyalty tier thresholds (by points)
    loyaltyTiers: {
      BRONZE: { min: 0, max: 499 },
      SILVER: { min: 500, max: 1999 },
      GOLD: { min: 2000, max: Infinity },
    },
  },

  /**
   * Reporting & Analytics
   */
  reporting: {
    // Default report pagination limit
    defaultPageLimit: 50,

    // Maximum records for export
    maxExportRecords: 10000,

    // Number of periods for trend analysis
    trendAnalysisPeriods: 12,
  },

  /**
   * Employee Performance
   */
  employee: {
    // Minimum sales for performance tracking
    minSalesForTracking: 1,

    // Target sales per shift
    targetSalesPerShift: 500,

    // Cash drawer variance threshold ($)
    cashVarianceThreshold: 10,
  },

  /**
   * System Defaults
   */
  system: {
    // Session timeout (minutes)
    sessionTimeout: 480, // 8 hours

    // Auto-logout after inactivity (minutes)
    autoLogoutMinutes: 60,

    // Receipt number prefix
    receiptPrefix: 'RCP',

    // Invoice number prefix
    invoicePrefix: 'INV',
  },
};

/**
 * Type-safe access to configuration values
 */
export type BusinessConfig = typeof businessConfig;

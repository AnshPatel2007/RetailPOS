/**
 * Production-safe logging utility
 * - Logs to console in development
 * - Can be extended to send to external service in production
 */

const isDevelopment = import.meta.env.MODE === 'development';

export const logger = {
  /**
   * Log informational messages (only in development)
   */
  info: (...args: any[]) => {
    if (isDevelopment) {
      console.log('[INFO]', ...args);
    }
  },

  /**
   * Log warning messages
   */
  warn: (...args: any[]) => {
    if (isDevelopment) {
      console.warn('[WARN]', ...args);
    }
  },

  /**
   * Log error messages
   * In production, this could send to error tracking service (Sentry, LogRocket, etc.)
   */
  error: (message: string, error?: any) => {
    if (isDevelopment) {
      console.error('[ERROR]', message, error);
    }

    // TODO: In production, send to error tracking service
    // Example: Sentry.captureException(error, { extra: { message } });
  },

  /**
   * Log debug messages (only in development)
   */
  debug: (...args: any[]) => {
    if (isDevelopment) {
      console.debug('[DEBUG]', ...args);
    }
  },
};

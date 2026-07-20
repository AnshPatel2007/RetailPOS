import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: process.env.PORT || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',

  jwt: {
    secret: process.env.JWT_SECRET || 'your-secret-key-min-32-characters-long',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  },

  database: {
    url: process.env.DATABASE_URL || '',
  },

  cors: {
    origin: process.env.FRONTEND_URL
      ? process.env.FRONTEND_URL.split(',').map(url => url.trim().replace(/\/$/, ''))
      : 'http://localhost:5173',
  },

  upload: {
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '5242880'), // 5MB
    uploadDir: process.env.UPLOAD_DIR || './uploads',
  },

  pagination: {
    defaultLimit: 20,
    maxLimit: 100,
  },

  email: {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.EMAIL_FROM || 'noreply@possystem.com',
    // Many hosts (Render included) block outbound SMTP entirely, so raw SMTP
    // only works reliably for local dev. When set, email.ts sends via
    // SendGrid's HTTPS API instead, which isn't affected by SMTP port blocks.
    sendgridApiKey: process.env.SENDGRID_API_KEY || '',
  },

  security: {
    maxLoginAttempts: parseInt(process.env.MAX_LOGIN_ATTEMPTS || '5'),
    lockoutDuration: parseInt(process.env.LOCKOUT_DURATION || '15'), // minutes
    passwordResetExpiry: parseInt(process.env.PASSWORD_RESET_EXPIRY || '60'), // minutes
    twoFactorIssuer: process.env.TWO_FACTOR_ISSUER || 'POS System',
  },

  app: {
    name: process.env.APP_NAME || 'POS System',
    // Password-reset emails link to this URL. Falls back to the first
    // FRONTEND_URL origin (already required for CORS in every deployment) so
    // reset links don't silently point at localhost when APP_URL is simply
    // never set — a separate, easy-to-miss variable from FRONTEND_URL.
    url:
      process.env.APP_URL ||
      process.env.FRONTEND_URL?.split(',')[0]?.trim().replace(/\/$/, '') ||
      'http://localhost:5173',
  },
};

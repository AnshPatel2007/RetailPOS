import nodemailer from 'nodemailer';
import { config } from '../config';
import { logger } from './logger';

// Create reusable transporter
const transporter = nodemailer.createTransport({
  host: config.email.host,
  port: config.email.port,
  secure: config.email.secure,
  auth: {
    user: config.email.user,
    pass: config.email.pass,
  },
});

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/**
 * Send an email
 */
export const sendEmail = async (options: EmailOptions): Promise<void> => {
  try {
    const mailOptions = {
      from: `"${config.app.name}" <${config.email.from}>`,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text || options.html.replace(/<[^>]*>/g, ''),
    };

    if (config.nodeEnv === 'development' && !config.email.user) {
      logger.info(`[DEV] Email would be sent to ${options.to}: ${options.subject}`);
      logger.info(`[DEV] Email content: ${options.html}`);
      return;
    }

    await transporter.sendMail(mailOptions);
    logger.info(`Email sent to ${options.to}: ${options.subject}`);
  } catch (error) {
    logger.error('Error sending email:', error);
    throw new Error('Failed to send email');
  }
};

/**
 * Send password reset email
 */
export const sendPasswordResetEmail = async (
  email: string,
  resetToken: string,
  firstName: string
): Promise<void> => {
  const resetUrl = `${config.app.url}/reset-password?token=${resetToken}`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background-color: #4F46E5; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; background-color: #f9f9f9; }
        .button { display: inline-block; padding: 12px 24px; background-color: #4F46E5; color: white; text-decoration: none; border-radius: 4px; margin: 20px 0; }
        .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>${config.app.name}</h1>
        </div>
        <div class="content">
          <h2>Password Reset Request</h2>
          <p>Hello ${firstName},</p>
          <p>We received a request to reset your password. Click the button below to create a new password:</p>
          <p style="text-align: center;">
            <a href="${resetUrl}" class="button">Reset Password</a>
          </p>
          <p>This link will expire in ${config.security.passwordResetExpiry} minutes.</p>
          <p>If you didn't request this password reset, please ignore this email or contact support if you have concerns.</p>
          <p style="word-break: break-all; font-size: 12px; color: #666;">
            If the button doesn't work, copy and paste this link into your browser:<br>
            ${resetUrl}
          </p>
        </div>
        <div class="footer">
          <p>&copy; ${new Date().getFullYear()} ${config.app.name}. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  await sendEmail({
    to: email,
    subject: `Reset Your ${config.app.name} Password`,
    html,
  });
};

/**
 * Send 2FA enabled notification
 */
export const send2FAEnabledEmail = async (
  email: string,
  firstName: string
): Promise<void> => {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background-color: #4F46E5; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; background-color: #f9f9f9; }
        .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
        .warning { background-color: #FEF3C7; border-left: 4px solid #F59E0B; padding: 12px; margin: 16px 0; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>${config.app.name}</h1>
        </div>
        <div class="content">
          <h2>Two-Factor Authentication Enabled</h2>
          <p>Hello ${firstName},</p>
          <p>Two-factor authentication has been successfully enabled on your account.</p>
          <div class="warning">
            <strong>Important:</strong> Make sure to save your backup codes in a secure location.
            You'll need them if you lose access to your authenticator app.
          </div>
          <p>From now on, you'll need to enter a verification code from your authenticator app when signing in.</p>
          <p>If you didn't enable 2FA, please contact support immediately.</p>
        </div>
        <div class="footer">
          <p>&copy; ${new Date().getFullYear()} ${config.app.name}. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  await sendEmail({
    to: email,
    subject: `Two-Factor Authentication Enabled - ${config.app.name}`,
    html,
  });
};

/**
 * Send low stock alert email
 */
export const sendLowStockAlert = async (
  products: { name: string; sku: string; stock: number; threshold: number }[]
): Promise<void> => {
  // Read notification email from the store settings stored by the frontend
  // For now, use the configured email from env or skip if not set
  const to = config.email.from; // Default to store email — admin can configure in settings
  if (!to) return;

  const rows = products
    .map(
      (p) =>
        `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee">${p.name}</td><td style="padding:6px 12px;border-bottom:1px solid #eee">${p.sku}</td><td style="padding:6px 12px;border-bottom:1px solid #eee;color:#DC2626;font-weight:bold">${p.stock}</td><td style="padding:6px 12px;border-bottom:1px solid #eee">${p.threshold}</td></tr>`
    )
    .join('');

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background-color: #F59E0B; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; background-color: #f9f9f9; }
        table { width: 100%; border-collapse: collapse; margin: 16px 0; }
        th { background: #f3f4f6; padding: 8px 12px; text-align: left; font-size: 13px; }
        .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Low Stock Alert</h1>
        </div>
        <div class="content">
          <p>${products.length} product${products.length > 1 ? 's have' : ' has'} fallen below the low stock threshold:</p>
          <table>
            <thead><tr><th>Product</th><th>SKU</th><th>Current Stock</th><th>Threshold</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
          <p>Please reorder these items to avoid stockouts.</p>
        </div>
        <div class="footer">
          <p>&copy; ${new Date().getFullYear()} ${config.app.name}. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  await sendEmail({
    to,
    subject: `Low Stock Alert: ${products.length} product${products.length > 1 ? 's' : ''} need reorder - ${config.app.name}`,
    html,
  });
};

/**
 * Send account lockout notification
 */
export const sendAccountLockoutEmail = async (
  email: string,
  firstName: string,
  lockoutMinutes: number
): Promise<void> => {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background-color: #DC2626; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; background-color: #f9f9f9; }
        .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Security Alert</h1>
        </div>
        <div class="content">
          <h2>Account Temporarily Locked</h2>
          <p>Hello ${firstName},</p>
          <p>Your account has been temporarily locked due to multiple failed login attempts.</p>
          <p>Your account will be automatically unlocked in <strong>${lockoutMinutes} minutes</strong>.</p>
          <p>If this wasn't you, please reset your password immediately after the lockout period ends.</p>
        </div>
        <div class="footer">
          <p>&copy; ${new Date().getFullYear()} ${config.app.name}. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  await sendEmail({
    to: email,
    subject: `Security Alert: Account Locked - ${config.app.name}`,
    html,
  });
};

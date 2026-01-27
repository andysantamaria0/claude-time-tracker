import { Resend } from 'resend';
import { loadConfig } from '../config.js';
import { logger } from '../utils/logger.js';
import { markEmailSent } from '../storage/sqlite.js';
import { formatDuration, formatDateTime } from '../utils/formatting.js';
import { buildEmailHtml } from './template.js';
import type { Session } from '../types.js';

export async function sendSessionReport(session: Session): Promise<void> {
  const config = loadConfig();
  if (!config.email?.resendApiKey || !config.email?.recipientEmail) {
    throw new Error('Email not configured');
  }

  const resend = new Resend(config.email.resendApiKey);
  const fromEmail = config.email.fromEmail || 'tracker@resend.dev';

  const html = buildEmailHtml(session);
  const subject = `[Claude Tracker] ${session.projectName}: ${session.feature || 'Session'} (${formatDuration(session.durationMs)})`;

  const { error } = await resend.emails.send({
    from: fromEmail,
    to: config.email.recipientEmail,
    subject,
    html,
  });

  if (error) {
    throw new Error(`Resend error: ${error.message}`);
  }

  markEmailSent(session.id);
  logger.debug(`Email sent for session ${session.id}`);
}

export async function sendReportEmail(
  subject: string,
  html: string,
): Promise<void> {
  const config = loadConfig();
  if (!config.email?.resendApiKey || !config.email?.recipientEmail) {
    throw new Error('Email not configured');
  }

  const resend = new Resend(config.email.resendApiKey);
  const fromEmail = config.email.fromEmail || 'tracker@resend.dev';

  const { error } = await resend.emails.send({
    from: fromEmail,
    to: config.email.recipientEmail,
    subject,
    html,
  });

  if (error) {
    throw new Error(`Resend error: ${error.message}`);
  }
}

export async function testResendConnection(apiKey: string): Promise<boolean> {
  try {
    const resend = new Resend(apiKey);
    // Verify API key by listing domains (a lightweight operation)
    await resend.domains.list();
    return true;
  } catch {
    return false;
  }
}

export async function sendTestEmail(
  apiKey: string,
  from: string,
  to: string,
): Promise<void> {
  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from,
    to,
    subject: '[Claude Tracker] Test Email',
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #6b4fbb;">Claude Time Tracker</h2>
        <p>This is a test email from Claude Time Tracker.</p>
        <p>If you received this, your email configuration is working correctly!</p>
        <p style="color: #666; font-size: 14px;">Sent at ${new Date().toLocaleString()}</p>
      </div>
    `,
  });

  if (error) {
    throw new Error(`Resend error: ${error.message}`);
  }
}

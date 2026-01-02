import { Pool } from 'pg';

const DAILY_EMAIL_LIMIT = 90;

export class DailyLimitReachedError extends Error {
  constructor(message, resetTime) {
    super(message);
    this.name = 'DailyLimitReachedError';
    this.resetTime = resetTime;
  }
}

/**
 * Checks if the daily email sending limit has been reached for the current UTC day.
 * @param {Pool} pool - The PostgreSQL connection pool.
 * @returns {Promise<boolean>} - True if the limit is reached, false otherwise.
 */
export async function checkDailyEmailLimit(pool) {
  const client = await pool.connect();
  try {
    const now = new Date();
    const startOfUtcDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
    const endOfUtcDay = new Date(startOfUtcDay.getTime() + 24 * 60 * 60 * 1000);

    const result = await client.query(
      `SELECT COUNT(*) FROM system_email_ledger WHERE sent_at >= $1 AND sent_at < $2`,
      [startOfUtcDay, endOfUtcDay]
    );

    const sentCount = parseInt(result.rows[0].count, 10);
    return sentCount >= DAILY_EMAIL_LIMIT;
  } finally {
    client.release();
  }
}

/**
 * Sends a transactional email via Resend, with daily rate limiting.
 * @param {Pool} pool - The PostgreSQL connection pool.
 * @param {string} recipient - The recipient's email address.
 * @param {string} subject - The email subject.
 * @param {string} htmlContent - The HTML content of the email.
 * @param {string} purpose - The purpose of the email (e.g., 'magic_link_verification').
 * @throws {DailyLimitReachedError} If the daily email limit has been reached.
 * @throws {Error} If the email sending fails for other reasons.
 */
export async function sendTransactionalEmail(pool, recipient, subject, htmlContent, purpose) {
  const client = await pool.connect();
  try {
    const limitReached = await checkDailyEmailLimit(pool);
    if (limitReached) {
      const now = new Date();
      const startOfNextUtcDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
      throw new DailyLimitReachedError('Daily email sending limit reached.', startOfNextUtcDay.toISOString());
    }

    const resendApiKey = process.env.RESEND_API_KEY;
    if (!resendApiKey) {
      throw new Error('RESEND_API_KEY is not configured.');
    }

    // Use test email for development, custom domain for production
    const isProduction = process.env.NODE_ENV === 'production';
    const fromEmail = isProduction
      ? `noreply@${process.env.RESEND_DOMAIN || 'yourdomain.com'}`
      : 'delivered@resend.dev';

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [recipient],
        subject: subject,
        html: htmlContent,
      }),
    });

    const responseBody = await response.json();

    if (!response.ok) {
      // Log the failed email attempt
      await client.query(
        'INSERT INTO system_email_ledger (sent_at, purpose, recipient_email, status) VALUES (NOW(), $1, $2, $3)',
        [purpose, recipient, 'failed']
      );
      throw new Error(`Failed to send email: ${response.statusText} - ${JSON.stringify(responseBody)}`);
    }

    // Log the successful email attempt
    await client.query(
      'INSERT INTO system_email_ledger (sent_at, purpose, recipient_email, status) VALUES (NOW(), $1, $2, $3)',
      [purpose, recipient, 'sent']
    );

  } finally {
    client.release();
  }
}

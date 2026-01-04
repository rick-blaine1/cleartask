/**
 * Email Verification Routes
 * 
 * Extracted from backend/app.js:208-558
 * 
 * Handles email verification and authorized senders management:
 * - Request magic link for email verification
 * - Verify magic link
 * - Manage authorized senders (CRUD operations)
 */

import crypto from 'crypto';
import { emailVerificationSchema } from '../src/schemas/email.schema.js';
import { sendTransactionalEmail, DailyLimitReachedError } from '../src/email_ingestion/emailService.js';

const EMAIL_VERIFICATION_TOKEN_EXPIRATION_HOURS = 24;

export default async function emailVerificationRoutes(fastify, options) {
  const { pool } = options;

  // POST /api/email-ingestion/request-magic-link - Request a magic link for email verification
  // Extracted from backend/app.js:209-296
  fastify.post('/api/email-ingestion/request-magic-link', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const client = await pool.connect();
    try {
      const { email } = request.body;
      emailVerificationSchema.parse({ email });

      const userId = request.user.id;

      // Check if the email is already verified for this user
      const existingVerifiedSender = await client.query(
        'SELECT id FROM user_authorized_senders WHERE user_id = $1 AND email_address = $2 AND is_verified = TRUE',
        [userId, email]
      );

      if (existingVerifiedSender.rowCount > 0) {
        return reply.status(200).send({ message: 'Email is already verified.' });
      }

      // Generate a unique token with 384 bits of entropy
      const token = crypto.randomBytes(48).toString('base64url');
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + EMAIL_VERIFICATION_TOKEN_EXPIRATION_HOURS);

      // Hash the token before storing (defense-in-depth)
      const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

      // Store the hashed token in the database
      await client.query(
        'INSERT INTO email_verification_tokens (user_id, email, token, expires_at) VALUES ($1, $2, $3, $4)',
        [userId, email, hashedToken, expiresAt]
      );

      // In a real application, send an email with the magic link
      // For now, we'll log it
      const magicLink = `${process.env.FRONTEND_URL}/verify-email?token=${token}`;
      fastify.log.info(`Magic link for ${email}: ${magicLink}`);
      
      try {
        const emailHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify Your Email Address</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
  <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f5f5f5;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 600px; width: 100%; border-collapse: collapse; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <tr>
            <td style="padding: 40px 30px;">
              <h1 style="margin: 0 0 24px 0; font-size: 24px; font-weight: 600; color: #1a1a1a; line-height: 1.3;">
                Verify Your Email Address
              </h1>
              <p style="margin: 0 0 24px 0; font-size: 16px; line-height: 1.6; color: #333333;">
                Thank you for signing up! To complete your registration and start using our service, please verify your email address by clicking the button below.
              </p>
              <table role="presentation" style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td align="center" style="padding: 0 0 24px 0;">
                    <a href="${magicLink}"
                       style="display: inline-block; padding: 14px 32px; background-color: #007bff; color: #ffffff; text-decoration: none; border-radius: 6px; font-size: 16px; font-weight: 600; text-align: center;"
                       role="button"
                       aria-label="Verify your email address">
                      Verify Email Address
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin: 0 0 16px 0; font-size: 14px; line-height: 1.6; color: #666666;">
                If the button above doesn't work, you can copy and paste this link into your browser:
              </p>
              <p style="margin: 0 0 24px 0; font-size: 14px; line-height: 1.6; color: #007bff; word-break: break-all;">
                ${magicLink}
              </p>
              <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 24px 0;">
              <p style="margin: 0; font-size: 13px; line-height: 1.6; color: #999999;">
                This verification link will expire in ${EMAIL_VERIFICATION_TOKEN_EXPIRATION_HOURS} hours. If you didn't request this email, you can safely ignore it.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
        await sendTransactionalEmail(
          pool,
          email,
          'Verify your email address',
          emailHtml,
          'magic_link_verification'
        );
        reply.status(200).send({ message: 'Magic link sent to your email address.' });
      } catch (emailError) {
        if (emailError instanceof DailyLimitReachedError) {
          const now = new Date();
          const startOfNextUtcDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
          fastify.log.warn('Daily email limit reached.', { resetTime: startOfNextUtcDay.toISOString() });
          return reply.status(503).send({
            error: 'DailyLimitReached',
            message: 'Email service temporarily unavailable. Daily limit reached.',
            resetTime: startOfNextUtcDay.toISOString()
          });
        } else {
          throw emailError; // Re-throw other email errors
        }
      }

    } catch (error) {
      if (error instanceof z.ZodError) {
        fastify.log.warn('Request magic link validation failed:', error.errors);
        return reply.status(400).send({ message: 'Validation failed', errors: error.errors });
      } else {
        fastify.log.error('Error requesting magic link:', error);
        reply.status(500).send({ message: 'Failed to request magic link.', details: error.message });
      }
    } finally {
      client.release();
    }
  });

  // GET /api/authorized-senders - Fetch all authorized senders for the authenticated user
  // Extracted from backend/app.js:298-324
  fastify.get('/api/authorized-senders', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const client = await pool.connect();
    try {
      const userId = request.user.id;
      
      // First ensure the user exists in the users table
      const userCheck = await client.query('SELECT id FROM users WHERE id = $1', [userId]);
      if (userCheck.rowCount === 0) {
        // User doesn't exist yet, return empty array
        return reply.status(200).send([]);
      }
      
      const result = await client.query(
        'SELECT id, email_address as email, is_verified as "isVerified", created_at FROM user_authorized_senders WHERE user_id = $1 ORDER BY created_at DESC',
        [userId]
      );
      
      // Return empty array if no senders found (not an error)
      reply.status(200).send(result.rows);
    } catch (error) {
      fastify.log.error('Error fetching authorized senders:', error);
      reply.status(500).send({ message: 'Failed to fetch authorized senders.', details: error.message });
    } finally {
      client.release();
    }
  });

  // POST /api/authorized-senders - Add a new authorized sender
  // Extracted from backend/app.js:326-398
  fastify.post('/api/authorized-senders', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const client = await pool.connect();
    try {
      const { email } = request.body;
      fastify.log.info(`[ADD-SENDER] Starting add sender for email: ${email}`);
      
      if (!email || typeof email !== 'string') {
        fastify.log.warn(`[ADD-SENDER] Invalid email provided: ${email}`);
        return reply.status(400).send({ message: 'Valid email address is required.' });
      }
      
      const userId = request.user.id;
      fastify.log.info(`[ADD-SENDER] User ID: ${userId}`);
      
      // Check if user exists in users table
      const userCheck = await client.query('SELECT id FROM users WHERE id = $1', [userId]);
      fastify.log.info(`[ADD-SENDER] User exists check: ${userCheck.rowCount > 0}`);
      if (userCheck.rowCount === 0) {
        fastify.log.error(`[ADD-SENDER] User ${userId} not found in users table`);
        return reply.status(400).send({ message: 'User account not found. Please log out and log in again.' });
      }
      
      // Check if sender already exists for this user
      const existingResult = await client.query(
        'SELECT id, is_verified FROM user_authorized_senders WHERE user_id = $1 AND email_address = $2',
        [userId, email.toLowerCase()]
      );
      fastify.log.info(`[ADD-SENDER] Existing sender check: ${existingResult.rowCount}`);
      
      if (existingResult.rowCount > 0) {
        fastify.log.warn(`[ADD-SENDER] Email ${email} already exists for user ${userId}`);
        return reply.status(409).send({ message: 'This email address is already in your authorized senders list.' });
      }
      
      // Insert new sender (unverified by default)
      fastify.log.info(`[ADD-SENDER] Inserting new sender: ${email.toLowerCase()}`);
      const insertResult = await client.query(
        'INSERT INTO user_authorized_senders (user_id, email_address, is_verified) VALUES ($1, $2, FALSE) RETURNING id, email_address as email, is_verified as "isVerified", created_at',
        [userId, email.toLowerCase()]
      );
      fastify.log.info(`[ADD-SENDER] Insert successful, ID: ${insertResult.rows[0].id}`);
      
      // Generate verification token with 384 bits of entropy
      fastify.log.info(`[ADD-SENDER] Generating verification token`);
      const token = crypto.randomBytes(48).toString('base64url');
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + EMAIL_VERIFICATION_TOKEN_EXPIRATION_HOURS);
      
      // Hash the token before storing (defense-in-depth)
      const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
      
      fastify.log.info(`[ADD-SENDER] Inserting verification token`);
      await client.query(
        'INSERT INTO email_verification_tokens (user_id, email, token, expires_at) VALUES ($1, $2, $3, $4)',
        [userId, email.toLowerCase(), hashedToken, expiresAt]
      );
      fastify.log.info(`[ADD-SENDER] Token inserted successfully`);
      
      // Send verification email
      const magicLink = `${process.env.FRONTEND_URL}/verify-email?token=${token}`;
      fastify.log.info(`[ADD-SENDER] Verification link for ${email}: ${magicLink}`);
      fastify.log.info(`[ADD-SENDER] FRONTEND_URL: ${process.env.FRONTEND_URL}`);
      
      try {
        fastify.log.info(`[ADD-SENDER] Attempting to send verification email to ${email}`);
        const emailHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify Authorized Sender Email</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
  <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f5f5f5;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 600px; width: 100%; border-collapse: collapse; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <tr>
            <td style="padding: 40px 30px;">
              <h1 style="margin: 0 0 24px 0; font-size: 24px; font-weight: 600; color: #1a1a1a; line-height: 1.3;">
                Verify Authorized Sender Email
              </h1>
              <p style="margin: 0 0 24px 0; font-size: 16px; line-height: 1.6; color: #333333;">
                You've added this email address as an authorized sender. To complete the setup and allow this email to create tasks, please verify it by clicking the button below.
              </p>
              <table role="presentation" style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td align="center" style="padding: 0 0 24px 0;">
                    <a href="${magicLink}"
                       style="display: inline-block; padding: 14px 32px; background-color: #007bff; color: #ffffff; text-decoration: none; border-radius: 6px; font-size: 16px; font-weight: 600; text-align: center;"
                       role="button"
                       aria-label="Verify authorized sender email">
                      Verify Email Address
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin: 0 0 16px 0; font-size: 14px; line-height: 1.6; color: #666666;">
                If the button above doesn't work, you can copy and paste this link into your browser:
              </p>
              <p style="margin: 0 0 24px 0; font-size: 14px; line-height: 1.6; color: #007bff; word-break: break-all;">
                ${magicLink}
              </p>
              <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 24px 0;">
              <p style="margin: 0; font-size: 13px; line-height: 1.6; color: #999999;">
                This verification link will expire in ${EMAIL_VERIFICATION_TOKEN_EXPIRATION_HOURS} hours. If you didn't request this email, you can safely ignore it.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
        await sendTransactionalEmail(
          pool,
          email,
          'Verify your authorized sender email',
          emailHtml,
          'sender_verification'
        );
        fastify.log.info(`[ADD-SENDER] Verification email sent successfully`);
      } catch (emailError) {
        fastify.log.error(`[ADD-SENDER] Email sending error: ${emailError.message}`, { error: emailError, stack: emailError.stack });
        if (emailError instanceof DailyLimitReachedError) {
          const now = new Date();
          const startOfNextUtcDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
          fastify.log.warn('[ADD-SENDER] Daily email limit reached.', { resetTime: startOfNextUtcDay.toISOString() });
          return reply.status(503).send({
            error: 'DailyLimitReached',
            message: 'Email service temporarily unavailable. Daily limit reached.',
            resetTime: startOfNextUtcDay.toISOString()
          });
        }
        // Log but don't fail if email sending fails
        fastify.log.error('[ADD-SENDER] Failed to send verification email, continuing anyway:', emailError);
      }
      
      fastify.log.info(`[ADD-SENDER] Sending 201 response with sender data`);
      reply.status(201).send(insertResult.rows[0]);
    } catch (error) {
      fastify.log.error('[ADD-SENDER] Error adding authorized sender:', error);
      fastify.log.error('[ADD-SENDER] Error stack:', error.stack);
      fastify.log.error('[ADD-SENDER] Error details:', { name: error.name, message: error.message, code: error.code });
      reply.status(500).send({ message: 'Failed to add authorized sender.', details: error.message });
    } finally {
      client.release();
    }
  });

  // DELETE /api/authorized-senders/:id - Remove an authorized sender
  // Extracted from backend/app.js:400-423
  fastify.delete('/api/authorized-senders/:id', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const client = await pool.connect();
    try {
      const { id } = request.params;
      const userId = request.user.id;
      
      const result = await client.query(
        'DELETE FROM user_authorized_senders WHERE id = $1 AND user_id = $2 RETURNING id',
        [id, userId]
      );
      
      if (result.rowCount === 0) {
        return reply.status(404).send({ message: 'Authorized sender not found or you do not have permission to delete it.' });
      }
      
      reply.status(204).send();
    } catch (error) {
      fastify.log.error('Error deleting authorized sender:', error);
      reply.status(500).send({ message: 'Failed to delete authorized sender.', details: error.message });
    } finally {
      client.release();
    }
  });

  // POST /api/authorized-senders/:id/resend-verification - Resend verification email
  // Extracted from backend/app.js:425-504
  fastify.post('/api/authorized-senders/:id/resend-verification', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const client = await pool.connect();
    try {
      const { id } = request.params;
      const userId = request.user.id;
      
      fastify.log.info(`[RESEND-VERIFICATION] Starting resend verification for sender ID: ${id}, user ID: ${userId}`);
      
      // Verify sender exists and belongs to user
      const senderResult = await client.query(
        'SELECT email_address, is_verified FROM user_authorized_senders WHERE id = $1 AND user_id = $2',
        [id, userId]
      );
      
      if (senderResult.rowCount === 0) {
        fastify.log.warn(`[RESEND-VERIFICATION] Sender not found: ID ${id}, user ${userId}`);
        return reply.status(404).send({ message: 'Authorized sender not found or you do not have permission to access it.' });
      }
      
      const { email_address, is_verified } = senderResult.rows[0];
      fastify.log.info(`[RESEND-VERIFICATION] Found sender: ${email_address}, verified: ${is_verified}`);
      
      if (is_verified) {
        fastify.log.warn(`[RESEND-VERIFICATION] Email already verified: ${email_address}`);
        return reply.status(400).send({ message: 'This email address is already verified.' });
      }
      
      // Generate new verification token with 384 bits of entropy
      const token = crypto.randomBytes(48).toString('base64url');
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + EMAIL_VERIFICATION_TOKEN_EXPIRATION_HOURS);
      
      fastify.log.info(`[RESEND-VERIFICATION] Generated token for ${email_address}, expires at ${expiresAt.toISOString()}`);
      
      // Hash the token before storing (defense-in-depth)
      const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
      
      await client.query(
        'INSERT INTO email_verification_tokens (user_id, email, token, expires_at) VALUES ($1, $2, $3, $4)',
        [userId, email_address, hashedToken, expiresAt]
      );
      
      fastify.log.info(`[RESEND-VERIFICATION] Token saved to database for ${email_address}`);
      
      // Send verification email
      const magicLink = `${process.env.FRONTEND_URL}/verify-email?token=${token}`;
      fastify.log.info(`[RESEND-VERIFICATION] Magic link: ${magicLink}`);
      fastify.log.info(`[RESEND-VERIFICATION] RESEND_API_KEY configured: ${!!process.env.RESEND_API_KEY}`);
      fastify.log.info(`[RESEND-VERIFICATION] RESEND_DOMAIN: ${process.env.RESEND_DOMAIN || 'NOT SET (will use default)'}`);
      
      try {
        fastify.log.info(`[RESEND-VERIFICATION] Calling sendTransactionalEmail for ${email_address}`);
        const emailHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify Authorized Sender Email</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
  <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f5f5f5;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 600px; width: 100%; border-collapse: collapse; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <tr>
            <td style="padding: 40px 30px;">
              <h1 style="margin: 0 0 24px 0; font-size: 24px; font-weight: 600; color: #1a1a1a; line-height: 1.3;">
                Verify Authorized Sender Email
              </h1>
              <p style="margin: 0 0 24px 0; font-size: 16px; line-height: 1.6; color: #333333;">
                You've requested a new verification link for this email address. To complete the setup and allow this email to create tasks, please verify it by clicking the button below.
              </p>
              <table role="presentation" style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td align="center" style="padding: 0 0 24px 0;">
                    <a href="${magicLink}"
                       style="display: inline-block; padding: 14px 32px; background-color: #007bff; color: #ffffff; text-decoration: none; border-radius: 6px; font-size: 16px; font-weight: 600; text-align: center;"
                       role="button"
                       aria-label="Verify authorized sender email">
                      Verify Email Address
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin: 0 0 16px 0; font-size: 14px; line-height: 1.6; color: #666666;">
                If the button above doesn't work, you can copy and paste this link into your browser:
              </p>
              <p style="margin: 0 0 24px 0; font-size: 14px; line-height: 1.6; color: #007bff; word-break: break-all;">
                ${magicLink}
              </p>
              <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 24px 0;">
              <p style="margin: 0; font-size: 13px; line-height: 1.6; color: #999999;">
                This verification link will expire in ${EMAIL_VERIFICATION_TOKEN_EXPIRATION_HOURS} hours. If you didn't request this email, you can safely ignore it.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
        await sendTransactionalEmail(
          pool,
          email_address,
          'Verify your authorized sender email',
          emailHtml,
          'sender_verification_resend'
        );
        fastify.log.info(`[RESEND-VERIFICATION] Email sent successfully to ${email_address}`);
        reply.status(200).send({ message: 'Verification email sent successfully.' });
      } catch (emailError) {
        fastify.log.error(`[RESEND-VERIFICATION] Email sending error: ${emailError.message}`, { error: emailError });
        if (emailError instanceof DailyLimitReachedError) {
          const now = new Date();
          const startOfNextUtcDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
          fastify.log.warn('Daily email limit reached.', { resetTime: startOfNextUtcDay.toISOString() });
          return reply.status(503).send({
            error: 'DailyLimitReached',
            message: 'Email service temporarily unavailable. Daily limit reached.',
            resetTime: startOfNextUtcDay.toISOString()
          });
        }
        throw emailError;
      }
    } catch (error) {
      fastify.log.error(`[RESEND-VERIFICATION] Outer catch error: ${error.message}`, { error: error, stack: error.stack });
      reply.status(500).send({ message: 'Failed to resend verification email.', details: error.message });
    } finally {
      client.release();
    }
  });

  // GET /api/email-ingestion/verify-magic-link - Verify the magic link
  // Extracted from backend/app.js:506-558
  fastify.get('/api/email-ingestion/verify-magic-link', async (request, reply) => {
    const client = await pool.connect();
    try {
      const { token } = request.query;
      fastify.log.info(`[VERIFY-MAGIC-LINK] Starting verification for token: ${token ? token.substring(0, 8) + '...' : 'MISSING'}`);
      
      if (!token) {
        fastify.log.warn('[VERIFY-MAGIC-LINK] No token provided');
        return reply.status(400).send({ message: 'Token is required.' });
      }

      // Hash the provided token to compare with stored hash
      const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

      fastify.log.info('[VERIFY-MAGIC-LINK] Querying database for token');
      const result = await client.query(
        'SELECT * FROM email_verification_tokens WHERE token = $1 AND used_at IS NULL AND expires_at > NOW()',
        [hashedToken]
      );

      if (result.rowCount === 0) {
        fastify.log.warn(`[VERIFY-MAGIC-LINK] Token not found, expired, or already used`);
        return reply.status(400).send({ message: 'Invalid, expired, or already used magic link.' });
      }

      const { user_id, email, token: storedHashedToken } = result.rows[0];
      fastify.log.info(`[VERIFY-MAGIC-LINK] Token valid for user: ${user_id}, email: ${email}`);

      // Verify using constant-time comparison to prevent timing attacks
      const isValid = crypto.timingSafeEqual(
        Buffer.from(hashedToken),
        Buffer.from(storedHashedToken)
      );

      if (!isValid) {
        fastify.log.warn('[VERIFY-MAGIC-LINK] Token hash mismatch (timing-safe comparison failed)');
        return reply.status(400).send({ message: 'Invalid magic link.' });
      }

      // Mark the token as used
      fastify.log.info('[VERIFY-MAGIC-LINK] Marking token as used');
      await client.query(
        'UPDATE email_verification_tokens SET used_at = NOW() WHERE token = $1',
        [hashedToken]
      );
      fastify.log.info('[VERIFY-MAGIC-LINK] Token marked as used successfully');

      // Add or update the user_authorized_senders table
      fastify.log.info('[VERIFY-MAGIC-LINK] Updating user_authorized_senders table');
      const senderResult = await client.query(
        'INSERT INTO user_authorized_senders (user_id, email_address, is_verified) VALUES ($1, $2, TRUE) ON CONFLICT (user_id, email_address) DO UPDATE SET is_verified = TRUE, created_at = NOW() RETURNING id, user_id, email_address, is_verified',
        [user_id, email]
      );
      fastify.log.info(`[VERIFY-MAGIC-LINK] Sender record updated: ${JSON.stringify(senderResult.rows[0])}`);

      fastify.log.info('[VERIFY-MAGIC-LINK] Verification completed successfully, sending 200 response');
      reply.status(200).send({ message: 'Email verified successfully.' });
      fastify.log.info('[VERIFY-MAGIC-LINK] Response sent');
    } catch (error) {
      fastify.log.error(`[VERIFY-MAGIC-LINK] Error during verification: ${error.message}`, { error, stack: error.stack });
      reply.status(500).send({ message: 'Failed to verify magic link.', details: error.message });
    } finally {
      client.release();
      fastify.log.info('[VERIFY-MAGIC-LINK] Database client released');
    }
  });
}

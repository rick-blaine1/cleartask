if (process.env.NODE_ENV === 'test') {
  console.log('Loading .env.test');
  import('dotenv').then(dotenv => dotenv.config({ path: './.env.test' }));
} else {
  import('dotenv').then(dotenv => dotenv.config({ path: './.env' }));
}

import Fastify from 'fastify';
import pg from 'pg';
import fastifyJwt from '@fastify/jwt';
import fastifyOAuth2 from '@fastify/oauth2';
import cors from '@fastify/cors';
import OpenAI from "openai";
import { processUserInput } from './inputProcessor.js';
import { buildTaskParsingPrompt, buildTaskSuggestionPrompt, buildEmailParsingPrompt, buildSentinelPrompt, sanitizeUserInput } from './promptTemplates.js';
import { validateLLMTaskOutput, createSafeFallbackTask, sanitizeForDatabase, LLMEmailTaskOutputSchema } from './src/schemas/task.schema.js';
import { llmLogger } from './utils/llmLogger.js';
import emailIngestionRoutes from './src/email_ingestion/index.js';
import crypto from 'crypto';

// In-memory store for pending delete confirmations
const pendingDeleteTasks = new Map();

import nodemailer from 'nodemailer';
import { emailVerificationSchema } from './src/schemas/email.schema.js';
import { getVerifiedUserIdsForSender } from './src/email_ingestion/emailVerification.js';
import { checkDailyEmailLimit, sendTransactionalEmail, DailyLimitReachedError } from './src/email_ingestion/emailService.js';
import cron from 'node-cron';


const EMAIL_VERIFICATION_TOKEN_EXPIRATION_HOURS = 24;

// Helper function to check if an email is in the whitelist (supports wildcards)
function isEmailWhitelisted(email, invitedUsers) {
  if (!invitedUsers || invitedUsers.length === 0) {
    return true; // If no whitelist is configured, all emails are allowed
  }

  return invitedUsers.some(pattern => {
    // Convert wildcard pattern to regex
    const regex = new RegExp(`^${pattern.replace(/\./g, '\\.').replace(/\*/g, '.*')}$`, 'i');
    return regex.test(email);
  });
}

function buildApp() {
  const fastify = Fastify({ logger: true });

  // Parse INVITED_USERS environment variable
  const invitedUsers = process.env.INVITED_USERS ?
    process.env.INVITED_USERS.split(',').map(email => email.trim()) :
    [];

  // Decorate fastify with invitedUsers
  fastify.decorate('invitedUsers', invitedUsers);

  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable is required');
  }
  fastify.register(fastifyJwt, {
    secret: process.env.JWT_SECRET
  });

  fastify.register(fastifyOAuth2, {
    name: 'googleOAuth2',
    scope: ['profile', 'email'],
    credentials: {
      client: {
        id: process.env.GOOGLE_CLIENT_ID || '',
        secret: process.env.GOOGLE_CLIENT_SECRET || '',
      },
      auth: fastifyOAuth2.GOOGLE_CONFIGURATION
    },
    startRedirectPath: '/api/auth/google',
    callbackUri: `${process.env.BASE_URL || 'http://localhost:3000'}/api/auth/google/callback`,
  });

  // Register Microsoft OAuth2 without startRedirectPath to avoid route conflict
  fastify.register(fastifyOAuth2, {
    name: 'microsoftOAuth2', // Unique name for Microsoft OAuth
    scope: ['openid', 'profile', 'email', 'offline_access', 'User.Read'], // Add User.Read scope for Graph API access
    credentials: {
      client: {
        id: process.env.MICROSOFT_CLIENT_ID || '',
        secret: process.env.MICROSOFT_CLIENT_SECRET || '',
      },
      auth: {
        authorizeHost: 'https://login.microsoftonline.com',
        authorizePath: '/common/oauth2/v2.0/authorize',
        tokenHost: 'https://login.microsoftonline.com',
        tokenPath: '/common/oauth2/v2.0/token'
      }
    },
    // Don't use startRedirectPath - we'll create a custom route instead
    callbackUri: `${process.env.BASE_URL || 'http://localhost:3000'}/api/auth/microsoft/callback`,
    generateStateFunction: () => {
      return Math.random().toString(36).substring(7);
    },
    checkStateFunction: () => true,
  });

  // Custom route to handle Microsoft OAuth with prompt parameter
  fastify.get('/api/auth/microsoft', async (request, reply) => {
    fastify.log.info('=== Microsoft OAuth Initiation ===');
    fastify.log.info(`Query params received: ${JSON.stringify(request.query)}`);
    
    // Get the authorization URL from the OAuth2 plugin (await the promise)
    const authorizationUrl = await fastify.microsoftOAuth2.generateAuthorizationUri(request, reply);
    
    // Add prompt=select_account to force account selection
    const urlWithPrompt = `${authorizationUrl}&prompt=select_account`;
    
    fastify.log.info(`Original authorization URL: ${authorizationUrl}`);
    fastify.log.info(`Modified authorization URL with prompt: ${urlWithPrompt}`);
    
    reply.redirect(urlWithPrompt);
  });

  fastify.register(cors, {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
  });

  const { Pool } = pg;
  const pool = new Pool({
    user: process.env.POSTGRES_USER || 'user',
    host: process.env.POSTGRES_HOST || 'localhost',
    database: process.env.POSTGRES_DB || 'cleartaskdb',
    password: process.env.POSTGRES_PASSWORD || 'password',
    port: process.env.POSTGRES_PORT || 5432,
  });

  // Expose pool for initialization
  fastify.decorate('pool', pool);

  // Initialize OpenAI client only if API key is provided
  const openai = process.env.OPENAI_API_KEY ? new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  }) : null;

  // Initialize Requesty client only if API key is provided
  const requesty = process.env.REQUESTY_API_KEY ? new OpenAI({
    apiKey: process.env.REQUESTY_API_KEY,
    baseURL: "https://router.requesty.ai/v1",
  }) : null;

  fastify.decorate("authenticate", async function (request, reply) {
    try {
      await request.jwtVerify();
      request.user.id = request.user.userId;
    } catch (err) {
      reply.send(err)
    }
  });

  fastify.register(emailIngestionRoutes, { pool, openai, requesty, llmLogger });

  // Endpoint to request a magic link for email verification
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

      // Generate a unique token
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + EMAIL_VERIFICATION_TOKEN_EXPIRATION_HOURS);

      // Store the token in the database
      await client.query(
        'INSERT INTO email_verification_tokens (user_id, email, token, expires_at) VALUES ($1, $2, $3, $4)',
        [userId, email, token, expiresAt]
      );

      // In a real application, send an email with the magic link
      // For now, we'll log it
      const magicLink = `${process.env.FRONTEND_URL}/verify-email?token=${token}`;
      fastify.log.info(`Magic link for ${email}: ${magicLink}`);

      // TODO: Implement actual email sending using nodemailer
      // const transporter = nodemailer.createTransport({
      //   host: process.env.EMAIL_HOST,
      //   port: process.env.EMAIL_PORT,
      //   secure: process.env.EMAIL_SECURE === 'true',
      //   auth: {
      //     user: process.env.EMAIL_USER,
      //     pass: process.env.EMAIL_PASS,
      //   },
      // });
      //
      // await transporter.sendMail({
      //   from: 'noreply@your-app.com',
      //   to: email,
      //   subject: 'Verify your email address',
      //   html: `<p>Click <a href=\"${magicLink}\">here</a> to verify your email address.</p>`,
      // });
      
      try {
        await sendTransactionalEmail(
          pool, 
          email, 
          'Verify your email address', 
          `<p>Click <a href=\"${magicLink}\">here</a> to verify your email address.</p>`,
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
  fastify.post('/api/authorized-senders', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const client = await pool.connect();
    try {
      const { email } = request.body;
      
      if (!email || typeof email !== 'string') {
        return reply.status(400).send({ message: 'Valid email address is required.' });
      }
      
      const userId = request.user.id;
      
      // Check if sender already exists for this user
      const existingResult = await client.query(
        'SELECT id, is_verified FROM user_authorized_senders WHERE user_id = $1 AND email_address = $2',
        [userId, email.toLowerCase()]
      );
      
      if (existingResult.rowCount > 0) {
        return reply.status(409).send({ message: 'This email address is already in your authorized senders list.' });
      }
      
      // Insert new sender (unverified by default)
      const insertResult = await client.query(
        'INSERT INTO user_authorized_senders (user_id, email_address, is_verified) VALUES ($1, $2, FALSE) RETURNING id, email_address as email, is_verified as "isVerified", created_at',
        [userId, email.toLowerCase()]
      );
      
      // Generate verification token
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + EMAIL_VERIFICATION_TOKEN_EXPIRATION_HOURS);
      
      await client.query(
        'INSERT INTO email_verification_tokens (user_id, email, token, expires_at) VALUES ($1, $2, $3, $4)',
        [userId, email.toLowerCase(), token, expiresAt]
      );
      
      // Send verification email
      const magicLink = `${process.env.FRONTEND_URL}/verify-email?token=${token}`;
      fastify.log.info(`Verification link for ${email}: ${magicLink}`);
      
      try {
        await sendTransactionalEmail(
          pool,
          email,
          'Verify your authorized sender email',
          `<p>Click <a href="${magicLink}">here</a> to verify this email address as an authorized sender.</p>`,
          'sender_verification'
        );
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
        }
        // Log but don't fail if email sending fails
        fastify.log.error('Failed to send verification email:', emailError);
      }
      
      reply.status(201).send(insertResult.rows[0]);
    } catch (error) {
      fastify.log.error('Error adding authorized sender:', error);
      reply.status(500).send({ message: 'Failed to add authorized sender.', details: error.message });
    } finally {
      client.release();
    }
  });

  // DELETE /api/authorized-senders/:id - Remove an authorized sender
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
      
      // Generate new verification token
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + EMAIL_VERIFICATION_TOKEN_EXPIRATION_HOURS);
      
      fastify.log.info(`[RESEND-VERIFICATION] Generated token for ${email_address}, expires at ${expiresAt.toISOString()}`);
      
      await client.query(
        'INSERT INTO email_verification_tokens (user_id, email, token, expires_at) VALUES ($1, $2, $3, $4)',
        [userId, email_address, token, expiresAt]
      );
      
      fastify.log.info(`[RESEND-VERIFICATION] Token saved to database for ${email_address}`);
      
      // Send verification email
      const magicLink = `${process.env.FRONTEND_URL}/verify-email?token=${token}`;
      fastify.log.info(`[RESEND-VERIFICATION] Magic link: ${magicLink}`);
      fastify.log.info(`[RESEND-VERIFICATION] RESEND_API_KEY configured: ${!!process.env.RESEND_API_KEY}`);
      fastify.log.info(`[RESEND-VERIFICATION] RESEND_DOMAIN: ${process.env.RESEND_DOMAIN || 'NOT SET (will use default)'}`);
      
      try {
        fastify.log.info(`[RESEND-VERIFICATION] Calling sendTransactionalEmail for ${email_address}`);
        await sendTransactionalEmail(
          pool,
          email_address,
          'Verify your authorized sender email',
          `<p>Click <a href="${magicLink}">here</a> to verify this email address as an authorized sender.</p>`,
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

  // Endpoint to verify the magic link
  fastify.get('/api/email-ingestion/verify-magic-link', async (request, reply) => {
    const client = await pool.connect();
    try {
      const { token } = request.query;
      fastify.log.info(`[VERIFY-MAGIC-LINK] Starting verification for token: ${token ? token.substring(0, 8) + '...' : 'MISSING'}`);
      
      if (!token) {
        fastify.log.warn('[VERIFY-MAGIC-LINK] No token provided');
        return reply.status(400).send({ message: 'Token is required.' });
      }

      fastify.log.info('[VERIFY-MAGIC-LINK] Querying database for token');
      const result = await client.query(
        'SELECT * FROM email_verification_tokens WHERE token = $1 AND used_at IS NULL AND expires_at > NOW()',
        [token]
      );

      if (result.rowCount === 0) {
        fastify.log.warn(`[VERIFY-MAGIC-LINK] Token not found, expired, or already used: ${token.substring(0, 8)}...`);
        return reply.status(400).send({ message: 'Invalid, expired, or already used magic link.' });
      }

      const { user_id, email } = result.rows[0];
      fastify.log.info(`[VERIFY-MAGIC-LINK] Token valid for user: ${user_id}, email: ${email}`);

      // Mark the token as used
      fastify.log.info('[VERIFY-MAGIC-LINK] Marking token as used');
      await client.query(
        'UPDATE email_verification_tokens SET used_at = NOW() WHERE token = $1',
        [token]
      );
      fastify.log.info('[VERIFY-MAGIC-LINK] Token marked as used successfully');

      // Add or update the user_authorized_senders table
      fastify.log.info('[VERIFY-MAGIC-LINK] Updating user_authorized_senders table');
      const senderResult = await client.query(
        'INSERT INTO user_authorized_senders (user_id, email_address, is_verified) VALUES ($1, $2, TRUE) ON CONFLICT (email_address) DO UPDATE SET user_id = EXCLUDED.user_id, is_verified = TRUE, created_at = NOW() RETURNING id, user_id, email_address, is_verified',
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

  fastify.get('/', async (request, reply) => {
    return { hello: 'world' };
  });

  fastify.get('/api/tasks', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    try {
      const client = await pool.connect();
      const showArchived = request.query.showArchived === 'true';
      const query = showArchived 
        ? 'SELECT * FROM tasks WHERE user_id = $1 ORDER BY due_date ASC NULLS FIRST'
        : 'SELECT * FROM tasks WHERE user_id = $1 AND is_archived = FALSE ORDER BY due_date ASC NULLS FIRST';
      const result = await client.query(
        query,
        [request.user.id]
      );
      client.release();
      reply.send(result.rows);
    } catch (err) {
      fastify.log.error(err);
      reply.status(500).send({ error: 'Internal Server Error' });
    }
  });

  fastify.get('/protected', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    return { user: request.user };
  });

  fastify.get('/api/auth/google/callback', async function (request, reply) {
    try {
      const { token } = await this.googleOAuth2.getAccessTokenFromAuthorizationCodeFlow(request);
      
      // Fetch the user's Google profile using the access token
      const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: {
          Authorization: `Bearer ${token.access_token}`,
        },
      });

      if (!userInfoResponse.ok) {
        throw new Error('Failed to fetch user info from Google');
      }

      const googleUserProfile = await userInfoResponse.json();
      
      // Check if email is whitelisted
      if (!isEmailWhitelisted(googleUserProfile.email, invitedUsers)) {
        fastify.log.warn(`Login attempt from non-whitelisted email: ${googleUserProfile.email}`);
        return reply.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/#error=access_denied`);
      }
      
      // Use the Google user's unique ID as the user ID
      const userId = `google-${googleUserProfile.id}`;
      
      // Optionally, store or update user information in the database
      const client = await pool.connect();
      try {
        await client.query(
          `INSERT INTO users (id, email, name)
           VALUES ($1, $2, $3)
           ON CONFLICT (id) DO UPDATE
           SET email = EXCLUDED.email, name = EXCLUDED.name`,
          [userId, googleUserProfile.email, googleUserProfile.name]
        );
      } catch (dbError) {
        fastify.log.error('Error storing user info:', dbError);
        // Continue even if user storage fails
      } finally {
        client.release();
      }

      const ourJwt = fastify.jwt.sign({ userId });
      reply.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/#token=${ourJwt}`);
    } catch (error) {
      fastify.log.error('OAuth callback error:', error);
      reply.status(500).send({ error: 'OAuth callback failed' });
    }
  });

  fastify.get('/api/auth/microsoft/callback', async function (request, reply) {
    try {
      const { token } = await this.microsoftOAuth2.getAccessTokenFromAuthorizationCodeFlow(request);
      
      // Fetch the user's Microsoft profile using the access token
      const userInfoResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: {
          Authorization: `Bearer ${token.access_token}`,
        },
      });

      if (!userInfoResponse.ok) {
        const errorBody = await userInfoResponse.text();
        fastify.log.error(`Microsoft Graph API error response: ${errorBody}`);
        throw new Error('Failed to fetch user info from Microsoft Graph API');
      }

      const microsoftUserProfile = await userInfoResponse.json();

      // Extract relevant user info
      const userId = `microsoft-${microsoftUserProfile.id}`; // Prefix to avoid collisions
      const email = microsoftUserProfile.mail || microsoftUserProfile.userPrincipalName; // Get email
      const name = microsoftUserProfile.displayName;

      // Check if email is whitelisted
      if (!isEmailWhitelisted(email, invitedUsers)) {
        fastify.log.warn(`Login attempt from non-whitelisted email: ${email}`);
        return reply.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/#error=access_denied`);
      }

      // Database operations
      const client = await pool.connect();
      try {
        await client.query(
          `INSERT INTO users (id, email, name)
           VALUES ($1, $2, $3)
           ON CONFLICT (id) DO UPDATE
           SET email = EXCLUDED.email, name = EXCLUDED.name`,
          [userId, email, name]
        );
      } catch (dbError) {
        fastify.log.error('Error storing Microsoft user info:', dbError);
      } finally {
        client.release();
      }

      // Generate and sign our custom JWT
      const ourJwt = fastify.jwt.sign({ userId });

      // Redirect to frontend with JWT
      reply.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/#token=${ourJwt}`);

    } catch (error) {
      fastify.log.error('Microsoft OAuth callback error:', error.message);
      fastify.log.error('Microsoft OAuth callback stack:', error.stack);
      reply.status(500).send({ error: 'Microsoft OAuth callback failed' });
    }
  });

  fastify.post('/api/tasks/create-from-voice', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    
    try {
      const { transcribedText: rawTranscribedText, clientDate, clientTimezoneOffset } = request.body;
      
      // Log initial request with security context
      llmLogger.info({
        requestId,
        userId: request.user.id,
        event: 'llm_request_start',
        rawInputLength: rawTranscribedText?.length || 0,
        timestamp: new Date().toISOString()
      }, 'LLM task parsing request initiated');
      
      const transcribedText = processUserInput(rawTranscribedText, request.user.id);

      if (!transcribedText) {
        llmLogger.warn({
          requestId,
          userId: request.user.id,
          event: 'input_validation_failed',
          reason: 'empty_transcribed_text'
        }, 'Request rejected: empty transcribed text');
        return reply.status(400).send({ error: 'Transcribed text is required.' });
      }

      let rawLLMOutput = null;
      let llmUsed = 'None';
      const clientCurrentDate = new Date(clientDate);
      clientCurrentDate.setMinutes(clientCurrentDate.getMinutes() - clientTimezoneOffset);
      const currentTimeForLLM = clientCurrentDate.toISOString().split('T')[0];

      // Fetch existing tasks for context
      const client = await pool.connect();
      let existingTasks = [];
      try {
        const tasksResult = await client.query(
          'SELECT id, task_name, due_date, is_completed FROM tasks WHERE user_id = $1 AND is_archived = FALSE ORDER BY due_date ASC NULLS FIRST',
          [request.user.id]
        );
        existingTasks = tasksResult.rows;
        fastify.log.info(`Found ${existingTasks.length} existing tasks for user ${request.user.id}`);
      } catch (err) {
        fastify.log.error('Error fetching existing tasks:', err);
      } finally {
        client.release();
      }

      // Use reusable prompt template with sanitized input
      const sanitizedInput = sanitizeUserInput(transcribedText);
      
      // Log input sanitization
      if (sanitizedInput !== transcribedText) {
        llmLogger.warn({
          requestId,
          userId: request.user.id,
          event: 'input_sanitized',
          originalLength: transcribedText.length,
          sanitizedLength: sanitizedInput.length,
          changeDetected: true
        }, 'User input was sanitized before LLM processing');
      }
      
      const prompt = buildTaskParsingPrompt({
        transcribedText: sanitizedInput,
        currentDate: currentTimeForLLM,
        existingTasks
      });
      
      // Log prompt construction (without full content to avoid log bloat)
      llmLogger.debug({
        requestId,
        userId: request.user.id,
        event: 'prompt_constructed',
        promptLength: prompt.length,
        existingTasksCount: existingTasks.length
      }, 'LLM prompt constructed');
      
      const callLLM = async (llmClient, modelName, timeoutMs) => {
        const timeoutPromise = new Promise((resolve, reject) => {
          setTimeout(() => {
            reject(new Error(`${modelName} API call for task parsing timed out after ${timeoutMs / 1000} seconds`));
          }, timeoutMs);
        });

        const llmCallPromise = llmClient.chat.completions.create({
          model: modelName,
          messages: [{
            role: "user",
            content: prompt
          }],
          response_format: { type: "json_object" },
        });

        const response = await Promise.race([llmCallPromise, timeoutPromise]);
        return JSON.parse(response.choices[0].message.content);
      };

      // Try Requesty first
      if (requesty) {
        try {
          llmLogger.debug({
            requestId,
            userId: request.user.id,
            event: 'llm_call_start',
            provider: 'Requesty',
            model: 'openai/gpt-4o-mini',
            timeout: 5000
          }, 'Attempting LLM call to Requesty');
          
          rawLLMOutput = await callLLM(requesty, "openai/gpt-4o-mini", 5000);
          llmUsed = 'Requesty';
          
          llmLogger.info({
            requestId,
            userId: request.user.id,
            event: 'llm_call_success',
            provider: 'Requesty',
            outputSize: JSON.stringify(rawLLMOutput).length
          }, 'Task parsed successfully using Requesty');
        } catch (requestyError) {
          llmLogger.warn({
            requestId,
            userId: request.user.id,
            event: 'llm_call_failed',
            provider: 'Requesty',
            error: requestyError.message,
            willFallback: !!openai
          }, 'Requesty failed or timed out, falling back to OpenAI');
          
          // Fallback to OpenAI if Requesty fails
          if (openai) {
            try {
              llmLogger.debug({
                requestId,
                userId: request.user.id,
                event: 'llm_call_start',
                provider: 'OpenAI',
                model: 'gpt-4o-mini',
                timeout: 3000,
                isFallback: true
              }, 'Attempting fallback LLM call to OpenAI');
              
              rawLLMOutput = await callLLM(openai, "gpt-4o-mini", 3000);
              llmUsed = 'OpenAI';
              
              llmLogger.info({
                requestId,
                userId: request.user.id,
                event: 'llm_call_success',
                provider: 'OpenAI',
                outputSize: JSON.stringify(rawLLMOutput).length,
                isFallback: true
              }, 'Task parsed successfully using OpenAI fallback');
            } catch (openaiError) {
              llmLogger.error({
                requestId,
                userId: request.user.id,
                event: 'llm_call_failed',
                provider: 'OpenAI',
                error: openaiError.message,
                isFallback: true
              }, 'OpenAI fallback also failed');
            }
          }
        }
      } else if (openai) {
        // If Requesty is not configured, try OpenAI directly
        try {
          llmLogger.debug({
            requestId,
            userId: request.user.id,
            event: 'llm_call_start',
            provider: 'OpenAI',
            model: 'gpt-4o-mini',
            timeout: 3000
          }, 'Attempting LLM call to OpenAI');
          
          rawLLMOutput = await callLLM(openai, "gpt-4o-mini", 3000);
          llmUsed = 'OpenAI';
          
          llmLogger.info({
            requestId,
            userId: request.user.id,
            event: 'llm_call_success',
            provider: 'OpenAI',
            outputSize: JSON.stringify(rawLLMOutput).length
          }, 'Task parsed successfully using OpenAI');
        } catch (openaiError) {
          llmLogger.error({
            requestId,
            userId: request.user.id,
            event: 'llm_call_failed',
            provider: 'OpenAI',
            error: openaiError.message
          }, 'OpenAI API call failed');
        }
      }

      // CRITICAL SECURITY CONTROL: Validate LLM output before any database operations
      // This is the trust boundary - LLM output is untrusted until validated
      let validatedTaskData;
      let usedFallback = false;
      
      if (rawLLMOutput) {
        llmLogger.info({
          requestId,
          userId: request.user.id,
          event: 'llm_output_received',
          outputStructure: Object.keys(rawLLMOutput),
          outputSize: JSON.stringify(rawLLMOutput).length
        }, 'Raw LLM output received');
        
        // Log full output in debug mode only
        llmLogger.debug({
          requestId,
          userId: request.user.id,
          rawLLMOutput
        }, 'Full LLM output (debug)');
        
        const validationResult = validateLLMTaskOutput(rawLLMOutput);
        
        if (validationResult.success) {
          llmLogger.info({
            requestId,
            userId: request.user.id,
            event: 'validation_success',
            intent: validationResult.data.intent,
            hasTaskId: !!validationResult.data.task_id
          }, 'LLM output passed schema validation');
          
          validatedTaskData = sanitizeForDatabase(validationResult.data);
        } else {
          // Schema validation failed - log and use safe fallback
          llmLogger.warn({
            requestId,
            userId: request.user.id,
            event: 'validation_failed',
            error: validationResult.error?.message,
            issues: validationResult.issues,
            securitySignal: 'VALIDATION_FAILURE'
          }, 'LLM output failed schema validation - potential prompt injection or malformed output');
          
          llmLogger.warn({
            requestId,
            userId: request.user.id,
            event: 'fallback_activated',
            reason: 'validation_failed'
          }, 'Using safe fallback task creation');
          
          validatedTaskData = createSafeFallbackTask(transcribedText);
          usedFallback = true;
          llmUsed = 'Fallback (Validation Failed)';
        }
      } else {
        // No LLM output - use safe fallback
        llmLogger.warn({
          requestId,
          userId: request.user.id,
          event: 'fallback_activated',
          reason: 'no_llm_output',
          securitySignal: 'NO_LLM_OUTPUT'
        }, 'No LLM configured or all LLMs failed, using safe fallback for task parsing');
        
        validatedTaskData = createSafeFallbackTask(transcribedText);
        usedFallback = true;
        llmUsed = 'Fallback (No LLM)';
      }

      llmLogger.info({
        requestId,
        userId: request.user.id,
        event: 'task_data_validated',
        llmUsed,
        intent: validatedTaskData.intent,
        taskId: validatedTaskData.task_id,
        usedFallback
      }, 'Task data validated and ready for processing');

      // SEPARATION OF RESPONSIBILITIES: Application logic decides database operations
      // The LLM only suggests - the application enforces
      const dbClient = await pool.connect();
      try {
        // Business logic validation: edit_task and delete_task require valid task_id
        if ((validatedTaskData.intent === "edit_task" || validatedTaskData.intent === "delete_task") && validatedTaskData.task_id) {
          // Verify task exists and belongs to user before allowing edit or delete
          const verifyResult = await dbClient.query(
            'SELECT id FROM tasks WHERE id = $1 AND user_id = $2',
            [validatedTaskData.task_id, request.user.id]
          );
          
          if (verifyResult.rowCount === 0) {
            // Task doesn't exist or doesn't belong to user - fail closed to create_task
            llmLogger.warn({
              requestId,
              userId: request.user.id,
              event: 'intent_downgraded',
              originalIntent: validatedTaskData.intent,
              newIntent: 'create_task',
              taskId: validatedTaskData.task_id,
              reason: 'task_not_found_or_unauthorized',
              securitySignal: 'INTENT_DOWNGRADE'
            }, `Task not found or unauthorized for ${validatedTaskData.intent} - failing closed to create_task`);
            
            validatedTaskData.intent = 'create_task';
            validatedTaskData.task_id = null;
          }
        }
        
        // Execute database operation based on validated intent
        if (validatedTaskData.intent === "edit_task" && validatedTaskData.task_id) {
          llmLogger.info({
            requestId,
            userId: request.user.id,
            event: 'database_operation',
            operation: 'update_task',
            taskId: validatedTaskData.task_id
          }, 'Executing task update operation');
          
          const updateQuery = `
            UPDATE tasks
            SET
              task_name = COALESCE($1, task_name),
              due_date = COALESCE($2, due_date),
              is_completed = COALESCE($3, is_completed),
              original_request = COALESCE($4, original_request),
              message_id = COALESCE($5, message_id),
              updated_at = CURRENT_TIMESTAMP
            WHERE id = $6 AND user_id = $7
            RETURNING id, task_name, due_date, is_completed, original_request, is_archived, message_id;
          `;
          const updateResult = await dbClient.query(
            updateQuery,
            [
              validatedTaskData.task_name,
              validatedTaskData.due_date,
              validatedTaskData.is_completed,
              validatedTaskData.original_request,
              validatedTaskData.message_id,
              validatedTaskData.task_id,
              request.user.id
            ]
          );

          if (updateResult.rowCount === 0) {
            llmLogger.error({
              requestId,
              userId: request.user.id,
              event: 'database_operation_failed',
              operation: 'update_task',
              taskId: validatedTaskData.task_id,
              reason: 'task_not_found'
            }, 'Task update failed - task not found');
            
            reply.status(404).send({ error: 'Task not found or user not authorized for update.' });
          } else {
            llmLogger.info({
              requestId,
              userId: request.user.id,
              event: 'database_operation_success',
              operation: 'update_task',
              taskId: updateResult.rows[0].id
            }, 'Task updated successfully');
            
            reply.status(200).send(updateResult.rows[0]);
          }
        } else if (validatedTaskData.intent === "delete_task" && validatedTaskData.task_id) {
          llmLogger.info({
            requestId,
            userId: request.user.id,
            event: 'delete_confirmation_requested',
            operation: 'delete_task',
            taskId: validatedTaskData.task_id
          }, 'Requesting deletion confirmation from user');

          // Generate a unique confirmation ID
          const confirmationId = crypto.randomBytes(16).toString('hex');
          
          // Store the pending deletion with a 10-second timeout
          const timeoutId = setTimeout(() => {
            // Remove the pending deletion after timeout
            if (pendingDeleteTasks.has(confirmationId)) {
              pendingDeleteTasks.delete(confirmationId);
              llmLogger.info({
                requestId,
                userId: request.user.id,
                event: 'delete_confirmation_timeout',
                confirmationId,
                taskId: validatedTaskData.task_id
              }, 'Delete confirmation timed out after 10 seconds');
            }
          }, 10000); // 10 seconds

          // Store the pending deletion
          pendingDeleteTasks.set(confirmationId, {
            taskId: validatedTaskData.task_id,
            userId: request.user.id,
            requestId,
            timeoutId,
            createdAt: Date.now()
          });

          llmLogger.info({
            requestId,
            userId: request.user.id,
            event: 'delete_confirmation_pending',
            confirmationId,
            taskId: validatedTaskData.task_id
          }, 'Delete confirmation pending');

          // Send confirmation prompt to frontend
          reply.status(202).send({
            requiresConfirmation: true,
            confirmationId,
            taskId: validatedTaskData.task_id,
            message: 'Please confirm task deletion',
            timeoutSeconds: 10
          });
        } else {
          // Default to create_task (fail-closed behavior)
          llmLogger.info({
            requestId,
            userId: request.user.id,
            event: 'database_operation',
            operation: 'create_task',
            isFailClosed: validatedTaskData.intent !== 'create_task'
          }, 'Executing task creation operation');
          
          const insertResult = await dbClient.query(
            'INSERT INTO tasks (id, user_id, task_name, due_date, is_completed, original_request) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5) RETURNING id, task_name, due_date, is_completed, original_request, is_archived',
            [request.user.id, validatedTaskData.task_name, validatedTaskData.due_date, validatedTaskData.is_completed, validatedTaskData.original_request]
          );
          
          llmLogger.info({
            requestId,
            userId: request.user.id,
            event: 'database_operation_success',
            operation: 'create_task',
            taskId: insertResult.rows[0].id
          }, 'Task created successfully');
          
          reply.status(201).send(insertResult.rows[0]);
        }
      } catch (dbError) {
        fastify.log.error('Database error during task operation:', dbError);
        throw dbError; // Re-throw to be caught by outer catch
      } finally {
        dbClient.release();
      }

    } catch (error) {
      llmLogger.error({
        requestId,
        userId: request.user?.id,
        event: 'request_failed',
        error: error.message,
        stack: error.stack
      }, 'Error processing task from voice');
      
      reply.status(500).send({ error: 'Failed to process task from voice.', details: error.message });
    }
  });

  // Endpoint to handle delete confirmation
  fastify.post('/api/tasks/confirm-delete/:confirmationId', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { confirmationId } = request.params;
      const { confirmed } = request.body;

      llmLogger.info({
        userId: request.user.id,
        event: 'delete_confirmation_received',
        confirmationId,
        confirmed
      }, 'Delete confirmation response received');

      // Check if the confirmation exists
      const pendingDelete = pendingDeleteTasks.get(confirmationId);

      if (!pendingDelete) {
        llmLogger.warn({
          userId: request.user.id,
          event: 'delete_confirmation_not_found',
          confirmationId
        }, 'Confirmation ID not found or expired');
        
        return reply.status(404).send({ error: 'Confirmation not found or expired.' });
      }

      // Verify the user owns this confirmation
      if (pendingDelete.userId !== request.user.id) {
        llmLogger.warn({
          userId: request.user.id,
          event: 'delete_confirmation_unauthorized',
          confirmationId,
          expectedUserId: pendingDelete.userId
        }, 'User does not own this confirmation');
        
        return reply.status(403).send({ error: 'Unauthorized.' });
      }

      // Clear the timeout
      clearTimeout(pendingDelete.timeoutId);

      // Remove from pending map
      pendingDeleteTasks.delete(confirmationId);

      if (confirmed === true) {
        // User confirmed - proceed with deletion
        llmLogger.info({
          requestId: pendingDelete.requestId,
          userId: request.user.id,
          event: 'delete_confirmed',
          confirmationId,
          taskId: pendingDelete.taskId
        }, 'User confirmed deletion - proceeding');

        const client = await pool.connect();
        try {
          const deleteResult = await client.query(
            'DELETE FROM tasks WHERE id = $1 AND user_id = $2 RETURNING id',
            [pendingDelete.taskId, request.user.id]
          );

          if (deleteResult.rowCount === 0) {
            llmLogger.error({
              requestId: pendingDelete.requestId,
              userId: request.user.id,
              event: 'database_operation_failed',
              operation: 'delete_task',
              taskId: pendingDelete.taskId,
              reason: 'task_not_found'
            }, 'Task deletion failed - task not found');
            
            reply.status(404).send({ error: 'Task not found or user not authorized for deletion.' });
          } else {
            llmLogger.info({
              requestId: pendingDelete.requestId,
              userId: request.user.id,
              event: 'database_operation_success',
              operation: 'delete_task',
              taskId: pendingDelete.taskId
            }, 'Task deleted successfully after confirmation');
            
            reply.status(204).send(); // No Content
          }
        } finally {
          client.release();
        }
      } else {
        // User cancelled or denied
        llmLogger.info({
          requestId: pendingDelete.requestId,
          userId: request.user.id,
          event: 'delete_cancelled',
          confirmationId,
          taskId: pendingDelete.taskId
        }, 'User cancelled deletion');

        reply.status(200).send({ message: 'Deletion cancelled.' });
      }
    } catch (error) {
      fastify.log.error('Error processing delete confirmation:', error);
      reply.status(500).send({ error: 'Failed to process confirmation.', details: error.message });
    }
  });

  fastify.post('/api/openai-task-suggestion', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    try {
      // If OpenAI client is not initialized, use fallback immediately
      if (!openai) {
        fastify.log.warn('OpenAI API key not configured, using fallback');
        return reply.send({ suggestion: 'Consider organizing your desk.', fallback: true });
      }

      const timeoutPromise = new Promise((resolve, reject) => {
        setTimeout(() => {
          reject(new Error('OpenAI API call timed out after 3 seconds'));
        }, 3000);
      });

      // Use reusable prompt template
      const prompt = buildTaskSuggestionPrompt();
      
      const openaiCallPromise = openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{
          role: "user",
          content: prompt
        }],
      });

      const response = await Promise.race([
        openaiCallPromise,
        timeoutPromise
      ]);

      reply.send({ suggestion: response.choices[0].message.content });

    } catch (error) {
      fastify.log.error('OpenAI API error:', error);

      // Fallback mechanism (you can expand this to use another LLM or a predefined list)
      reply.send({ suggestion: 'Consider organizing your desk.', fallback: true });
    }
  });

  fastify.delete('/api/tasks/:id', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params;
      const client = await pool.connect();
      const result = await client.query(
        'DELETE FROM tasks WHERE id = $1 AND user_id = $2 RETURNING id',
        [id, request.user.id]
      );
      client.release();

      if (result.rowCount === 0) {
        reply.status(404).send({ error: 'Task not found or user not authorized.' });
      } else {
        reply.status(204).send(); // No Content
      }
    } catch (err) {
      fastify.log.error(err);
      reply.status(500).send({ error: 'Internal Server Error' });
    }
  });

  fastify.put('/api/tasks/:id', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params;
      const { task_name, description, due_date } = request.body;

      const client = await pool.connect();
      const result = await client.query(
        `UPDATE tasks
         SET task_name = COALESCE($1, task_name),
             description = COALESCE($2, description),
             due_date = COALESCE($3, due_date),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $4 AND user_id = $5
         RETURNING id, task_name, description, due_date, is_completed, original_request, is_archived`,
        [task_name, description, due_date, id, request.user.id]
      );
      client.release();

      if (result.rowCount === 0) {
        reply.status(404).send({ error: 'Task not found or user not authorized.' });
      } else {
        reply.status(200).send(result.rows[0]);
      }
    } catch (err) {
      fastify.log.error(err);
      reply.status(500).send({ error: 'Internal Server Error' });
    }
  });

  fastify.put('/api/tasks/:id/archive', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params;
      const { is_archived } = request.body;

      if (typeof is_archived !== 'boolean') {
        return reply.status(400).send({ error: 'Invalid value for is_archived. Must be a boolean.' });
      }

      const client = await pool.connect();
      const result = await client.query(
        'UPDATE tasks SET is_archived = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND user_id = $3 RETURNING id, is_archived',
        [is_archived, id, request.user.id]
      );
      client.release();

      if (result.rowCount === 0) {
        reply.status(404).send({ error: 'Task not found or user not authorized.' });
      } else {
        reply.status(200).send(result.rows[0]);
      }
    } catch (err) {
      fastify.log.error(err);
      reply.status(500).send({ error: 'Internal Server Error' });
    }
  });

  // Catch-all route for debugging 404s
  fastify.post('/api/email-webhook', async (request, reply) => {
    // This endpoint receives push notifications from Google Cloud Pub/Sub.
    // The message is Base64-encoded within the 'message.data' field of the Pub/Sub message.
    
    fastify.log.info('Received Google Pub/Sub webhook notification.');
    fastify.log.debug(`Webhook payload: ${JSON.stringify(request.body)}`);

    try {
      if (!request.body || !request.body.message || !request.body.message.data) {
        fastify.log.warn('Invalid Pub/Sub message format received.');
        return reply.status(400).send({ error: 'Invalid Pub/Sub message format.' });
      }

      const pubsubMessage = request.body.message;
      const data = Buffer.from(pubsubMessage.data, 'base64').toString('utf8');
      const jsonData = JSON.parse(data);

      fastify.log.info(`Decoded Pub/Sub message data: ${JSON.stringify(jsonData)}`);
      // TODO: Implement logic to process the email notification (e.g., fetch email, update sync state)

      // Acknowledge the message. Pub/Sub push subscriptions expect a 200 OK to acknowledge.
      reply.status(200).send('OK');

    } catch (error) {
      fastify.log.error(`Error processing webhook: ${error.message}`);
      reply.status(500).send({ error: 'Internal Server Error', details: error.message });
    }
  });

  fastify.setNotFoundHandler((request, reply) => {
    fastify.log.warn(`=== 404 Not Found ===`);
    fastify.log.warn(`Method: ${request.method}`);
    fastify.log.warn(`URL: ${request.url}`);
    fastify.log.warn(`Path: ${request.routeOptions?.url || 'N/A'}`);
    fastify.log.warn(`Query: ${JSON.stringify(request.query)}`);
    reply.status(404).send({ error: 'Route not found', path: request.url });
  });

  // Log all registered routes for debugging
  fastify.ready(() => {
    fastify.log.info('=== Registered Routes ===');
    const routes = fastify.printRoutes();
    fastify.log.info(routes);
  });

  return fastify;
}

if (process.env.NODE_ENV !== 'test') {
  const start = async () => {
    const app = buildApp();
    
    // Retry logic for database connection
    const connectWithRetry = async (maxRetries = 10, delayMs = 1000) => {
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          app.log.info(`Attempting to connect to database (attempt ${attempt}/${maxRetries})...`);
          app.log.info(`Database config from docker-compose: host=${process.env.DB_HOST}, database=${process.env.DB_NAME}, user=${process.env.DB_USER}, port=${process.env.DB_PORT}`);
          app.log.info(`Database config from .env: host=${process.env.POSTGRES_HOST}, database=${process.env.POSTGRES_DB}, user=${process.env.POSTGRES_USER}, port=${process.env.POSTGRES_PORT}`);
          app.log.info(`Pool will use: host=${process.env.POSTGRES_HOST || 'localhost'}, database=${process.env.POSTGRES_DB || 'cleartaskdb'}, user=${process.env.POSTGRES_USER || 'user'}, port=${process.env.POSTGRES_PORT || 5432}`);
          
          const client = await app.pool.connect();
          app.log.info('Successfully connected to database');
          return client;
        } catch (error) {
          app.log.warn(`Database connection attempt ${attempt} failed: ${error.message}`);
          app.log.warn(`Error details: ${JSON.stringify({
            code: error.code,
            errno: error.errno,
            syscall: error.syscall,
            hostname: error.hostname,
            address: error.address
          })}`);
          app.log.warn(`Stack trace: ${error.stack}`);

          
          if (attempt === maxRetries) {
            throw new Error(`Failed to connect to database after ${maxRetries} attempts: ${error.message}`);
          }
          
          const waitTime = delayMs * attempt; // Exponential backoff
          app.log.info(`Waiting ${waitTime}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    };
    
    // Wait for database initialization before starting the server
    try {
      const client = await connectWithRetry();
      
      try {
        // Create users table
        app.log.info('Creating users table...');
        await client.query(`
          CREATE TABLE IF NOT EXISTS users (
            id VARCHAR(255) PRIMARY KEY,
            email VARCHAR(255) NOT NULL,
            name VARCHAR(255),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `);
        app.log.info('Users table created successfully');
        
        app.log.info('Creating users email index...');
        await client.query(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);`);
        app.log.info('Users email index created successfully');

        // Create tasks table
        app.log.info('Creating tasks table...');
        await client.query(`
          CREATE TABLE IF NOT EXISTS tasks (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id VARCHAR(255) NOT NULL,
            task_name TEXT NOT NULL,
            description TEXT,
            due_date DATE,
            is_completed BOOLEAN DEFAULT FALSE,
            original_request TEXT,
            message_id VARCHAR(255),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            is_archived BOOLEAN DEFAULT FALSE
          );
        `);
        
        // Add description column if it doesn't exist (for existing databases)
        app.log.info('Adding description column if it doesn\'t exist...');
        await client.query(`
          ALTER TABLE tasks
          ADD COLUMN IF NOT EXISTS description TEXT;
        `);

        // Add message_id column if it doesn't exist
        app.log.info('Adding message_id column if it doesn\'t exist...');
        await client.query(`
          ALTER TABLE tasks
          ADD COLUMN IF NOT EXISTS message_id VARCHAR(255);
        `);

        // Add original_request column if it doesn't exist
        app.log.info('Adding original_request column if it doesn\'t exist...');
        await client.query(`
          ALTER TABLE tasks
          ADD COLUMN IF NOT EXISTS original_request TEXT;
        `);
        app.log.info('Tasks table created successfully');
        
        app.log.info('Creating tasks indexes...');
        await client.query(`CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_tasks_is_archived ON tasks(is_archived);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_tasks_message_id ON tasks(message_id);`);
        app.log.info('Tasks indexes created successfully');

        // Create user_authorized_senders table
        app.log.info('Creating user_authorized_senders table...');
        await client.query(`
          CREATE TABLE IF NOT EXISTS user_authorized_senders (
            id SERIAL PRIMARY KEY,
            user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            email_address VARCHAR(255) UNIQUE NOT NULL,
            is_verified BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
          );
        `);
        app.log.info('User authorized senders table created successfully');

        app.log.info('Creating user_authorized_senders indexes...');
        await client.query(`CREATE INDEX IF NOT EXISTS idx_user_authorized_senders_user_id ON user_authorized_senders (user_id);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_user_authorized_senders_email_address ON user_authorized_senders (email_address);`);
        app.log.info('User authorized senders indexes created successfully');

        // Create email_verification_tokens table for magic link
        app.log.info('Creating email_verification_tokens table...');
        await client.query(`
          CREATE TABLE IF NOT EXISTS email_verification_tokens (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            email VARCHAR(255) NOT NULL,
            token VARCHAR(255) UNIQUE NOT NULL,
            expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
            used_at TIMESTAMP WITH TIME ZONE,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
          );
        `);
        app.log.info('Email verification tokens table created successfully');

        app.log.info('Creating email_verification_tokens indexes...');
        await client.query(`CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_user_id ON email_verification_tokens (user_id);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_token ON email_verification_tokens (token);`);
        app.log.info('Email verification tokens indexes created successfully');

        // Create email_processing_lock table
        app.log.info('Creating email_processing_lock table...');
        await client.query(`
          CREATE TABLE IF NOT EXISTS email_processing_lock (
            message_id VARCHAR(255) PRIMARY KEY,
            processed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
          );
        `);
        app.log.info('Email processing lock table created successfully');

        app.log.info('Creating email_processing_lock index...');
        await client.query(`CREATE INDEX IF NOT EXISTS idx_email_processing_lock_message_id ON email_processing_lock (message_id);`);
        app.log.info('Email processing lock index created successfully');

        // Create system_email_ledger table
        app.log.info('Creating system_email_ledger table...');
        await client.query(`
          CREATE TABLE IF NOT EXISTS system_email_ledger (
            id SERIAL PRIMARY KEY,
            sent_at TIMESTAMP WITH TIME ZONE NOT NULL,
            purpose VARCHAR(100) NOT NULL,
            recipient_email VARCHAR(255) NOT NULL,
            status VARCHAR(50) NOT NULL
          );
        `);
        app.log.info('System email ledger table created successfully');

        app.log.info('Creating system_email_ledger index on sent_at...');
        await client.query(`CREATE INDEX IF NOT EXISTS idx_system_email_ledger_sent_at ON system_email_ledger (sent_at);`);
        app.log.info('System email ledger index created successfully');

        // Create gmail_sync_state table
        app.log.info('Creating gmail_sync_state table...');
        await client.query(`
          CREATE TABLE IF NOT EXISTS gmail_sync_state (
            id SERIAL PRIMARY KEY,
            email_address VARCHAR(255) UNIQUE NOT NULL,
            history_id VARCHAR(255) NOT NULL,
            watch_expiration TIMESTAMP WITH TIME ZONE,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
          );
        `);
        app.log.info('Gmail sync state table created successfully');

        app.log.info('Creating gmail_sync_state index...');
        await client.query(`CREATE INDEX IF NOT EXISTS idx_gmail_sync_state_email ON gmail_sync_state (email_address);`);
        app.log.info('Gmail sync state index created successfully');

        app.log.info('Database schema initialized successfully');
      } finally {
        client.release();
      }
    } catch (error) {
      app.log.error(`Error initializing database schema: ${error.message}`);
      if (error.stack) {
        app.log.error(`Stack trace: ${error.stack}`);
      }
      process.exit(1);
    }
    
    // Initialize Gmail watch for push notifications
    if (process.env.GMAIL_APP_EMAIL && process.env.GCP_PUBSUB_TOPIC_NAME) {
      try {
        const { initializeGmailWatch } = await import('./src/email_ingestion/gmailWatchService.js');
        const historyId = await initializeGmailWatch(app.pool, app.log);
        app.log.info(`Gmail watch initialized successfully with historyId: ${historyId}`);
      } catch (error) {
        app.log.error('Failed to initialize Gmail watch:', error);
        app.log.warn('Gmail push notifications will not work. Falling back to polling only.');
      }
    } else {
      app.log.warn('Gmail watch not initialized: GMAIL_APP_EMAIL or GCP_PUBSUB_TOPIC_NAME not configured');
    }

    // Schedule Gmail watch renewal every 6 days (before 7-day expiration)
    if (process.env.GMAIL_APP_EMAIL && process.env.GCP_PUBSUB_TOPIC_NAME) {
      cron.schedule('0 0 */6 * *', async () => {
        try {
          const { renewGmailWatch } = await import('./src/email_ingestion/gmailWatchService.js');
          await renewGmailWatch(app.pool, app.log);
          app.log.info('Gmail watch renewed successfully');
        } catch (error) {
          app.log.error('Failed to renew Gmail watch:', error);
        }
      });
      app.log.info('Gmail watch renewal scheduler initialized (runs every 6 days)');
    }
    
    try {
      await app.listen({ port: 3000, host: '0.0.0.0' });
    } catch (err) {
      app.log.error(err);
      process.exit(1);
    }
  };
  start();
}

export default buildApp;

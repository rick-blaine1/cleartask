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
import rateLimit from '@fastify/rate-limit';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import OpenAI from "openai";
import crypto from 'crypto';
import cron from 'node-cron';

// Import modular components
import { createAuthenticateMiddleware } from './middleware/authenticate.js';
import authRoutes from './routes/auth.js';
import taskRoutes from './routes/tasks.js';
import emailVerificationRoutes from './routes/email-verification.js';
import { connectWithRetry, initializeSchema } from './db/init.js';

// Import existing modules
import emailIngestionRoutes from './src/email_ingestion/index.js';
import { llmLogger } from './utils/llmLogger.js';

// In-memory store for OAuth state tokens
// NOTE: For production, use Redis or another distributed cache for horizontal scaling
const oauthStateStore = new Map();

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
    secret: process.env.JWT_SECRET,
    cookie: {
      cookieName: 'jwt',
      signed: false
    }
  });

  // Register cookie plugin for httpOnly cookie support
  fastify.register(cookie);

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
    generateStateFunction: (request) => {
      // Generate cryptographically secure random state
      const state = crypto.randomBytes(32).toString('hex');
      
      // Store state with timestamp for expiration checking
      oauthStateStore.set(state, { timestamp: Date.now() });
      
      fastify.log.debug(`Generated OAuth state: ${state.substring(0, 8)}...`);
      return state;
    },
    checkStateFunction: (request, callback) => {
      const state = request.query.state;
      
      if (!state) {
        fastify.log.warn('OAuth callback missing state parameter');
        return callback(new Error('Missing state parameter'));
      }
      
      const stored = oauthStateStore.get(state);
      
      if (!stored) {
        fastify.log.warn(`OAuth state not found or already used: ${state.substring(0, 8)}...`);
        return callback(new Error('Invalid state'));
      }
      
      // Check state hasn't expired (5 minutes = 300000ms)
      const age = Date.now() - stored.timestamp;
      if (age > 300000) {
        oauthStateStore.delete(state);
        fastify.log.warn(`OAuth state expired (age: ${age}ms): ${state.substring(0, 8)}...`);
        return callback(new Error('State expired'));
      }
      
      // State is valid - remove it (one-time use)
      oauthStateStore.delete(state);
      fastify.log.debug(`OAuth state validated and consumed: ${state.substring(0, 8)}...`);
      callback();
    },
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

  // Register rate limiting globally
  fastify.register(rateLimit, {
    max: 100, // 100 requests
    timeWindow: '15 minutes', // per 15 minutes
    cache: 10000, // Cache up to 10,000 different IPs
    allowList: ['127.0.0.1'], // Localhost is exempt
    // Note: For production with multiple servers, use Redis:
    // redis: redisClient
  });

  // Register security headers with Helmet
  fastify.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", process.env.FRONTEND_URL || 'http://localhost:5173'],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true
    },
    frameguard: {
      action: 'deny'
    },
    noSniff: true,
    xssFilter: true,
    referrerPolicy: {
      policy: 'strict-origin-when-cross-origin'
    }
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

  // Register authentication middleware
  const authenticate = createAuthenticateMiddleware(fastify);
  fastify.decorate("authenticate", authenticate);

  // Register modular routes
  fastify.register(authRoutes, { pool, invitedUsers });
  fastify.register(taskRoutes, { pool, openai, requesty, llmLogger });
  fastify.register(emailVerificationRoutes, { pool });
  fastify.register(emailIngestionRoutes, { pool, openai, requesty, llmLogger });

  // Root endpoint
  fastify.get('/', async (request, reply) => {
    return { hello: 'world' };
  });

  // Webhook endpoint for Google Pub/Sub
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

  // 404 handler
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
    
    // Wait for database initialization before starting the server
    try {
      const client = await connectWithRetry(app.pool, app.log);
      
      try {
        await initializeSchema(client, app.log);
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

import Fastify from 'fastify';
import pg from 'pg';
import fastifyJwt from '@fastify/jwt';
import fastifyOAuth2 from '@fastify/oauth2';
import cors from '@fastify/cors';
import OpenAI from "openai";

function buildApp() {
  const fastify = Fastify({ logger: true });

  fastify.register(fastifyJwt, {
    secret: process.env.JWT_SECRET || 'supersecretjwtkey'
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

  fastify.register(cors, {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true
  });

  const { Pool } = pg;
  const pool = new Pool({
    user: process.env.DB_USER || 'user',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'cleartaskdb',
    password: process.env.DB_PASSWORD || 'password',
    port: process.env.DB_PORT || 5432,
  });

  // Initialize OpenAI client only if API key is provided
  const openai = process.env.OPENAI_API_KEY ? new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  }) : null;

  fastify.decorate("authenticate", async function (request, reply) {
    try {
      await request.jwtVerify();
      request.user.id = request.user.userId;
    } catch (err) {
      reply.send(err)
    }
  });

  fastify.get('/', async (request, reply) => {
    return { hello: 'world' };
  });

  fastify.get('/api/tasks', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    try {
      const client = await pool.connect();
      const result = await client.query(
        'SELECT * FROM tasks WHERE user_id = $1 AND is_completed = false ORDER BY due_date ASC NULLS FIRST',
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
      // For simplicity, we'll assume the Google token is valid and extract some user info
      // In a real app, you would validate this token with Google and fetch user profile.
      const userProfile = { id: 'google-user-' + Math.random().toString(36).substring(7), email: 'test@example.com' }; // Mock user profile

      const ourJwt = fastify.jwt.sign({ userId: userProfile.id });
      reply.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/#token=${ourJwt}`);
    } catch (error) {
      fastify.log.error('OAuth callback error:', error);
      reply.status(500).send({ error: 'OAuth callback failed' });
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

      const openaiCallPromise = openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [{
          role: "user",
          content: "Suggest a simple task for a todo list."
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

  return fastify;
}

if (process.env.NODE_ENV !== 'test') {
  const start = async () => {
    const app = buildApp();
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

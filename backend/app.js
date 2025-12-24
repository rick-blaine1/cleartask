import Fastify from 'fastify';
import pg from 'pg';
import fastifyJwt from '@fastify/jwt';
import fastifyOAuth2 from '@fastify/oauth2';

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

  const { Pool } = pg;
  const pool = new Pool({
    user: process.env.DB_USER || 'user',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'cleartaskdb',
    password: process.env.DB_PASSWORD || 'password',
    port: process.env.DB_PORT || 5432,
  });

  fastify.decorate("authenticate", async function (request, reply) {
    try {
      await request.jwtVerify();
      request.user = request.user || {};
      request.user.id = request.user.id || request.jwt.sub;
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
    const { token } = await this.googleOAuth2.getAccessTokenFromAuthorizationCodeFlow(request)
    reply.send({ token })
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

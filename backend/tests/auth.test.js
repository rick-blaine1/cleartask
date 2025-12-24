import { test } from 'tap';
import Fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';
import fastifyOAuth2 from '@fastify/oauth2';

import { JWT_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } from '../config'; // Assuming config file will be created later

function buildApp() {
  const app = Fastify({ logger: false });

  app.register(fastifyJwt, {
    secret: JWT_SECRET
  });

  app.register(fastifyOAuth2, {
    name: 'googleOAuth2',
    scope: ['profile', 'email'],
    credentials: {
      client: {
        id: GOOGLE_CLIENT_ID,
        secret: GOOGLE_CLIENT_SECRET,
      },
      auth: fastifyOAuth2.GOOGLE_CONFIGURATION
    },
    startRedirectPath: '/api/auth/google',
    callbackUri: '/api/auth/google/callback',
  });

  app.decorate("authenticate", async function (request, reply) {
    try {
      await request.jwtVerify()
    } catch (err) {
      reply.send(err)
    }
  })

  app.get('/api/tasks', { onRequest: [app.authenticate] }, async (request, reply) => {
    return { tasks: [] };
  });

  app.get('/api/auth/google/callback', async function (request, reply) {
    const { token } = await this.googleOAuth2.getAccessTokenFromAuthorizationCodeFlow(request)
    reply.send({ token })
  })

  return app;
}

test('GET /api/tasks returns 401 Unauthorized without a valid token', async (t) => {
  const app = buildApp();

  const response = await app.inject({
    method: 'GET',
    url: '/api/tasks'
  });

  t.equal(response.statusCode, 401, 'should return 401 Unauthorized');
  t.end();
});

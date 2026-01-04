/**
 * Authentication Middleware
 * 
 * Extracted from backend/app.js:197-204
 * 
 * This middleware verifies JWT tokens and attaches user information to the request.
 */

export function createAuthenticateMiddleware(fastify) {
  return async function authenticate(request, reply) {
    try {
      await request.jwtVerify();
      request.user.id = request.user.userId;
    } catch (err) {
      reply.send(err);
    }
  };
}

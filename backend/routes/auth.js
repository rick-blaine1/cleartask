/**
 * Authentication Routes
 * 
 * Extracted from backend/app.js:587-709
 * 
 * Handles OAuth callbacks for Google and Microsoft authentication.
 */

// Helper function to check if an email is in the whitelist (supports wildcards)
// Extracted from backend/app.js:38-49
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

export default async function authRoutes(fastify, options) {
  const { pool, invitedUsers } = options;

  // Google OAuth callback
  // Extracted from backend/app.js:587-643
  fastify.get('/api/auth/google/callback', {
    config: {
      rateLimit: {
        max: 5, // 5 requests
        timeWindow: '1 minute' // per minute
      }
    }
  }, async function (request, reply) {
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
      
      // Set JWT in httpOnly cookie instead of URL
      reply.setCookie('jwt', ourJwt, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax', // 'lax' allows cookie to be sent on navigation from OAuth provider
        maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
        path: '/'
      });
      
      reply.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/#login=success`);
    } catch (error) {
      fastify.log.error('OAuth callback error:', error);
      reply.status(500).send({ error: 'OAuth callback failed' });
    }
  });

  // Microsoft OAuth callback
  // Extracted from backend/app.js:645-709
  fastify.get('/api/auth/microsoft/callback', {
    config: {
      rateLimit: {
        max: 5, // 5 requests
        timeWindow: '1 minute' // per minute
      }
    }
  }, async function (request, reply) {
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

      // Set JWT in httpOnly cookie instead of URL
      reply.setCookie('jwt', ourJwt, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax', // 'lax' allows cookie to be sent on navigation from OAuth provider
        maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
        path: '/'
      });

      // Redirect to frontend with success indicator
      reply.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/#login=success`);

    } catch (error) {
      fastify.log.error('Microsoft OAuth callback error:', error.message);
      fastify.log.error('Microsoft OAuth callback stack:', error.stack);
      reply.status(500).send({ error: 'Microsoft OAuth callback failed' });
    }
  });

  // Logout endpoint to clear JWT cookie
  fastify.post('/api/auth/logout', async (request, reply) => {
    try {
      // Clear the JWT cookie
      reply.clearCookie('jwt', {
        path: '/'
      });
      
      reply.status(200).send({ message: 'Logged out successfully' });
    } catch (error) {
      fastify.log.error('Logout error:', error);
      reply.status(500).send({ error: 'Logout failed' });
    }
  });
}

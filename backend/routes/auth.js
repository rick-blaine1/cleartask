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
    const requestId = Math.random().toString(36).substring(7);
    fastify.log.info(`[${requestId}] === Microsoft OAuth Callback START ===`);
    fastify.log.info(`[${requestId}] Query params: ${JSON.stringify(request.query)}`);
    fastify.log.info(`[${requestId}] State from query: ${request.query.state?.substring(0, 8)}...`);
    fastify.log.info(`[${requestId}] Authorization code: ${request.query.code?.substring(0, 20)}...`);
    fastify.log.info(`[${requestId}] Callback URI configured: ${process.env.BASE_URL || 'http://localhost:3000'}/api/auth/microsoft/callback`);
    fastify.log.info(`[${requestId}] Microsoft Client ID: ${process.env.MICROSOFT_CLIENT_ID?.substring(0, 8)}...`);
    
    try {
      fastify.log.info(`[${requestId}] Step 1: Calling getAccessTokenFromAuthorizationCodeFlow...`);
      
      // Wrap the token exchange to catch and log detailed errors
      let tokenResult;
      try {
        tokenResult = await this.microsoftOAuth2.getAccessTokenFromAuthorizationCodeFlow(request);
      } catch (tokenError) {
        fastify.log.error(`[${requestId}] Token exchange failed with error name: ${tokenError.name}`);
        fastify.log.error(`[${requestId}] Token error message: ${tokenError.message}`);
        
        // Try to extract more details from the error (avoid circular JSON)
        if (tokenError.data) {
          try {
            fastify.log.error(`[${requestId}] Token error data: ${JSON.stringify(tokenError.data)}`);
          } catch (e) {
            fastify.log.error(`[${requestId}] Token error data (non-serializable):`, tokenError.data);
          }
        }
        if (tokenError.statusCode) {
          fastify.log.error(`[${requestId}] Token error status code: ${tokenError.statusCode}`);
        }
        if (tokenError.body) {
          try {
            const bodyStr = typeof tokenError.body === 'string' ? tokenError.body : JSON.stringify(tokenError.body);
            fastify.log.error(`[${requestId}] Token error body: ${bodyStr}`);
          } catch (e) {
            fastify.log.error(`[${requestId}] Token error body (non-serializable)`);
          }
        }
        if (tokenError.response) {
          fastify.log.error(`[${requestId}] Token error response status: ${tokenError.response.status}`);
          if (tokenError.response.data) {
            try {
              fastify.log.error(`[${requestId}] Token error response data: ${JSON.stringify(tokenError.response.data)}`);
            } catch (e) {
              fastify.log.error(`[${requestId}] Token error response data (non-serializable)`);
            }
          }
        }
        
        throw tokenError; // Re-throw to be caught by outer catch
      }
      
      fastify.log.info(`[${requestId}] Step 1: Token exchange successful`);
      fastify.log.debug(`[${requestId}] Token type: ${tokenResult.token?.token_type}`);
      fastify.log.debug(`[${requestId}] Access token present: ${!!tokenResult.token?.access_token}`);
      
      const { token } = tokenResult;
      
      // Fetch the user's Microsoft profile using the access token
      fastify.log.info(`[${requestId}] Step 2: Fetching user profile from Microsoft Graph API...`);
      const userInfoResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: {
          Authorization: `Bearer ${token.access_token}`,
        },
      });

      fastify.log.info(`[${requestId}] Step 2: Graph API response status: ${userInfoResponse.status}`);
      
      if (!userInfoResponse.ok) {
        const errorBody = await userInfoResponse.text();
        fastify.log.error(`[${requestId}] Microsoft Graph API error response: ${errorBody}`);
        throw new Error('Failed to fetch user info from Microsoft Graph API');
      }

      const microsoftUserProfile = await userInfoResponse.json();
      fastify.log.info(`[${requestId}] Step 2: User profile fetched successfully`);
      fastify.log.debug(`[${requestId}] User profile: ${JSON.stringify(microsoftUserProfile)}`);

      // Extract relevant user info
      const userId = `microsoft-${microsoftUserProfile.id}`; // Prefix to avoid collisions
      const email = microsoftUserProfile.mail || microsoftUserProfile.userPrincipalName; // Get email
      const name = microsoftUserProfile.displayName;

      fastify.log.info(`[${requestId}] Step 3: Extracted user info - userId: ${userId}, email: ${email}, name: ${name}`);

      // Check if email is whitelisted
      fastify.log.info(`[${requestId}] Step 4: Checking email whitelist...`);
      if (!isEmailWhitelisted(email, invitedUsers)) {
        fastify.log.warn(`[${requestId}] Login attempt from non-whitelisted email: ${email}`);
        return reply.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/#error=access_denied`);
      }
      fastify.log.info(`[${requestId}] Step 4: Email is whitelisted`);

      // Database operations
      fastify.log.info(`[${requestId}] Step 5: Storing user in database...`);
      const client = await pool.connect();
      try {
        await client.query(
          `INSERT INTO users (id, email, name)
           VALUES ($1, $2, $3)
           ON CONFLICT (id) DO UPDATE
           SET email = EXCLUDED.email, name = EXCLUDED.name`,
          [userId, email, name]
        );
        fastify.log.info(`[${requestId}] Step 5: User stored successfully`);
      } catch (dbError) {
        fastify.log.error(`[${requestId}] Error storing Microsoft user info:`, dbError);
      } finally {
        client.release();
      }

      // Generate and sign our custom JWT
      fastify.log.info(`[${requestId}] Step 6: Generating JWT...`);
      const ourJwt = fastify.jwt.sign({ userId });
      fastify.log.info(`[${requestId}] Step 6: JWT generated successfully`);

      // Set JWT in httpOnly cookie instead of URL
      fastify.log.info(`[${requestId}] Step 7: Setting JWT cookie...`);
      reply.setCookie('jwt', ourJwt, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax', // 'lax' allows cookie to be sent on navigation from OAuth provider
        maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
        path: '/'
      });
      fastify.log.info(`[${requestId}] Step 7: JWT cookie set (secure: ${process.env.NODE_ENV === 'production'})`);

      // Redirect to frontend with success indicator
      const redirectUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/#login=success`;
      fastify.log.info(`[${requestId}] Step 8: Redirecting to: ${redirectUrl}`);
      reply.redirect(redirectUrl);
      fastify.log.info(`[${requestId}] === Microsoft OAuth Callback SUCCESS ===`);

    } catch (error) {
      fastify.log.error(`[${requestId}] === Microsoft OAuth Callback FAILED ===`);
      fastify.log.error(`[${requestId}] Error name: ${error.name}`);
      fastify.log.error(`[${requestId}] Error message: ${error.message}`);
      fastify.log.error(`[${requestId}] Error stack:`, error.stack);
      
      // Log additional error details if available
      if (error.response) {
        fastify.log.error(`[${requestId}] Error response status: ${error.response.status}`);
        fastify.log.error(`[${requestId}] Error response data:`, error.response.data);
      }
      
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

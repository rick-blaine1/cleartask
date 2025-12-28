# Microsoft OAuth Implementation Plan

This document outlines the necessary steps to integrate Microsoft (Hotmail/Outlook) OAuth for user authentication, mirroring the existing Google OAuth implementation.

## 1. Frontend Changes

### 1.1 Initiate Login Flow
- **User Interface**: Add a "Login with Microsoft" button to the login page.
- **Action**: When the button is clicked, redirect the user to the backend's Microsoft OAuth initiation endpoint (e.g., `/api/auth/microsoft`). This endpoint will, in turn, redirect the user to Microsoft's authorization server.

### 1.2 Handle Redirect
- **Callback URL**: Configure the Microsoft OAuth application with a frontend redirect URI (e.g., `${FRONTEND_URL}/#token=`).
- **Token Extraction**: After successful authentication with Microsoft, the backend will redirect to this frontend URL with our custom JWT in the URL hash (e.g., `/#token=<JWT>`).
- **Client-Side Processing**: The frontend will extract the JWT from the URL hash, store it securely (e.g., `localStorage` or `sessionStorage`), and then redirect the user to the application's dashboard or home page.

### 1.3 State Management
- Implement logic to handle authenticated state based on the presence and validity of the JWT.

## 2. Backend Changes

### 2.1 Register Fastify OAuth2 Plugin for Microsoft
- **Installation**: Ensure `@fastify/oauth2` is installed.
- **Plugin Registration**: Register a new instance of `fastifyOAuth2` in `backend/app.js` for Microsoft.

```javascript
fastify.register(fastifyOAuth2, {
  name: 'microsoftOAuth2', // Unique name for Microsoft OAuth
  scope: ['openid', 'profile', 'email', 'offline_access'], // Define necessary scopes
  credentials: {
    client: {
      id: process.env.MICROSOFT_CLIENT_ID || '',
      secret: process.env.MICROSOFT_CLIENT_SECRET || '',
    },
    auth: fastifyOAuth2.MICROSOFT_CONFIGURATION // Use Microsoft's configuration (if available, otherwise custom)
    // Note: fastifyOAuth2.MICROSOFT_CONFIGURATION might not exist.
    // We might need to define it manually as an object:
    // auth: {
    //   authorizeHost: 'https://login.microsoftonline.com/common/oauth2/v2.0',
    //   authorizePath: '/authorize',
    //   tokenHost: 'https://login.microsoftonline.com/common/oauth2/v2.0',
    //   tokenPath: '/token'
    // }
  },
  startRedirectPath: '/api/auth/microsoft', // Endpoint to initiate Microsoft login
  callbackUri: `${process.env.BASE_URL || 'http://localhost:3000'}/api/auth/microsoft/callback`,
});
```

### 2.2 Implement Microsoft OAuth Callback Handler
- **Endpoint**: Create a GET route for `/api/auth/microsoft/callback`.
- **Authorization Code Exchange**: In this handler, use `this.microsoftOAuth2.getAccessTokenFromAuthorizationCodeFlow(request)` to exchange the authorization code for an access token.
- **Fetch User Profile**: Use the obtained access token to call Microsoft Graph API (e.g., `https://graph.microsoft.com/v1.0/me`) to fetch the user's profile information (ID, email, name).

```javascript
fastify.get('/api/auth/microsoft/callback', async function (request, reply) {
  try {
    const { token } = await this.microsoftOAuth2.getAccessTokenFromAuthorizationCodeFlow(request);

    const userInfoResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
      },
    });

    if (!userInfoResponse.ok) {
      throw new Error('Failed to fetch user info from Microsoft Graph API');
    }

    const microsoftUserProfile = await userInfoResponse.json();

    // Extract relevant user info
    const userId = `microsoft-${microsoftUserProfile.id}`; // Prefix to avoid collisions
    const email = microsoftUserProfile.mail || microsoftUserProfile.userPrincipalName; // Get email
    const name = microsoftUserProfile.displayName;

    // Database operations (see Section 2.3)
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
    fastify.log.error('Microsoft OAuth callback error:', error);
    reply.status(500).send({ error: 'Microsoft OAuth callback failed' });
  }
});
```

### 2.3 User Database Integration
- **Unique User ID**: Prefix the Microsoft user ID (e.g., `microsoft-`) to ensure uniqueness and prevent collisions with other OAuth providers (like Google users, which are currently `google-<ID>`).
- **Upsert Logic**: The existing `INSERT ... ON CONFLICT (id) DO UPDATE` logic for the `users` table will handle creating new users or updating existing ones based on their unique `id`.

## 3. Environment Variables

The following new environment variables will be required:

-   `MICROSOFT_CLIENT_ID`: The client ID obtained from registering the application with Microsoft Azure Portal.
-   `MICROSOFT_CLIENT_SECRET`: The client secret obtained from registering the application with Microsoft Azure Portal.
-   `MICROSOFT_OAUTH_SCOPE`: A comma-separated string of scopes requested (e.g., `openid profile email offline_access`).

These should be added to the `.env.example` file and documented for local development and deployment.

## 4. Dockerfile Considerations

-   **`backend/Dockerfile`**: No significant changes are anticipated for the `backend/Dockerfile`. The new dependencies will be handled by `npm install` during the build process, which is already part of the existing Dockerfile.
-   **`frontend/Dockerfile`**: No changes are expected.

## 5. Database Considerations

-   **`users` table**: The existing `users` table structure (`id`, `email`, `name`, `created_at`, `updated_at`) is sufficient.
    -   The `id` column will store the prefixed Microsoft user ID (e.g., `microsoft-a1b2c3d4...`).
    -   `email` will store the user's primary email from Microsoft.
    -   `name` will store the user's display name from Microsoft.
-   **No new tables or schema migrations are expected** solely for Microsoft OAuth.

## 6. Security Considerations

-   **Client Secret Protection**: `MICROSOFT_CLIENT_SECRET` must be kept confidential and never exposed in frontend code or client-side logs. It should be stored securely in environment variables or a secrets management service.
-   **Scope Minimization**: Only request the minimum necessary OAuth scopes (`openid`, `profile`, `email`) from Microsoft to adhere to the principle of least privilege. `offline_access` might be needed if refresh tokens are required for long-lived sessions or background operations.
-   **State Parameter**: The `fastify-oauth2` plugin should automatically handle the `state` parameter to mitigate Cross-Site Request Forgery (CSRF) attacks during the OAuth flow. Verify this behavior.
-   **JWT Security**: Ensure the JWTs issued by our backend are signed with a strong, secret key (`JWT_SECRET`) and have appropriate expiration times.
-   **Error Handling**: Implement robust error handling for all stages of the OAuth flow, including network errors, API errors, and database errors, to prevent information leakage and provide a graceful user experience.
-   **Input Validation**: Validate any data received from Microsoft to prevent unexpected values or malicious injections into our system, although the Graph API usually provides structured data.

This detailed plan provides a clear roadmap for integrating Microsoft OAuth into the application.

# Gmail Push Notifications - ClearTask Application Setup Guide

This guide walks you through configuring the ClearTask application to receive and process Gmail push notifications.

## Table of Contents
- [Prerequisites](#prerequisites)
- [Environment Variables Configuration](#environment-variables-configuration)
- [Application Startup Verification](#application-startup-verification)
- [Testing the Setup](#testing-the-setup)
- [Watch Renewal](#watch-renewal)
- [Troubleshooting](#troubleshooting)
- [Monitoring and Maintenance](#monitoring-and-maintenance)
- [Local Development Setup](#local-development-setup)

---

## Prerequisites

Before starting, ensure you have:

- **Completed GCP Setup**: Follow the [GCP Setup Guide](./GMAIL_PUSH_NOTIFICATIONS_GCP_SETUP.md) first
- **ClearTask backend running**: Backend application must be operational
- **PostgreSQL database**: Database must be accessible and configured
- **Required credentials from GCP**:
  - OAuth Client ID
  - OAuth Client Secret
  - Gmail Refresh Token
  - GCP Project ID
  - Pub/Sub Topic Name

---

## Environment Variables Configuration

All Gmail push notification configuration is done through environment variables in your `.env` file.

### Required Environment Variables

Add the following variables to your `backend/.env` file:

```bash
# ============================================
# Gmail API Configuration
# ============================================

# OAuth 2.0 Client ID from GCP Console
# Location: GCP Console > APIs & Services > Credentials
# Format: xxxxx.apps.googleusercontent.com
GMAIL_CLIENT_ID=your_client_id_from_gcp

# OAuth 2.0 Client Secret from GCP Console
# Location: GCP Console > APIs & Services > Credentials
# Format: GOCSPX-xxxxx or similar
GMAIL_CLIENT_SECRET=your_client_secret_from_gcp

# Refresh Token obtained via OAuth 2.0 Playground or script
# This token allows the app to access Gmail without repeated user login
# Format: 1//xxxxx (long alphanumeric string)
GMAIL_REFRESH_TOKEN=your_refresh_token

# The Gmail account that will receive emails for task creation
# This should be the same account used to generate the refresh token
# Format: your-app-email@gmail.com
GMAIL_APP_EMAIL=your-app-email@gmail.com

# ============================================
# Google Cloud Pub/Sub Configuration
# ============================================

# Your GCP Project ID
# Location: GCP Console > Project dropdown (shown below project name)
# Format: project-name-123456
GCP_PROJECT_ID=your-gcp-project-id

# Full Pub/Sub topic name (not just the topic ID)
# Format: projects/YOUR_PROJECT_ID/topics/TOPIC_NAME
# Example: projects/cleartask-gmail-integration/topics/gmail-push
GCP_PUBSUB_TOPIC_NAME=projects/your-gcp-project-id/topics/gmail-push
```

### Detailed Variable Explanations

#### `GMAIL_CLIENT_ID`
- **Where to find**: GCP Console > APIs & Services > Credentials > Your OAuth 2.0 Client
- **Format**: Ends with `.apps.googleusercontent.com`
- **Example**: `123456789-abcdefg.apps.googleusercontent.com`
- **Validation**: Should be a long string with numbers and letters

#### `GMAIL_CLIENT_SECRET`
- **Where to find**: GCP Console > APIs & Services > Credentials > Your OAuth 2.0 Client
- **Format**: Usually starts with `GOCSPX-` or similar prefix
- **Example**: `GOCSPX-AbCdEfGhIjKlMnOpQrStUvWx`
- **Security**: Never commit this to version control!

#### `GMAIL_REFRESH_TOKEN`
- **Where to find**: Generated via OAuth 2.0 Playground or authentication script (see GCP Setup Guide)
- **Format**: Usually starts with `1//` followed by a long alphanumeric string
- **Example**: `1//0gABCDEFGHIJKLMNOPQRSTUVWXYZ`
- **Validation**: Test by exchanging for an access token:
  ```bash
  curl -X POST https://oauth2.googleapis.com/token \
    -d "client_id=$GMAIL_CLIENT_ID" \
    -d "client_secret=$GMAIL_CLIENT_SECRET" \
    -d "refresh_token=$GMAIL_REFRESH_TOKEN" \
    -d "grant_type=refresh_token"
  ```
  Should return a JSON response with an `access_token` field.

#### `GMAIL_APP_EMAIL`
- **Where to find**: This is the Gmail address you want to use for the app
- **Format**: Standard email format
- **Example**: `cleartask-app@gmail.com`
- **Important**: Must be the same Gmail account used to generate the refresh token

#### `GCP_PROJECT_ID`
- **Where to find**: GCP Console > Project dropdown at the top (shown below the project name)
- **Format**: Lowercase letters, numbers, and hyphens
- **Example**: `cleartask-gmail-integration`
- **Validation**: Run `gcloud config get-value project` to verify

#### `GCP_PUBSUB_TOPIC_NAME`
- **Where to find**: GCP Console > Pub/Sub > Topics
- **Format**: `projects/PROJECT_ID/topics/TOPIC_NAME`
- **Example**: `projects/cleartask-gmail-integration/topics/gmail-push`
- **Common mistake**: Don't use just the topic name (e.g., `gmail-push`), use the full path
- **Validation**: Run `gcloud pubsub topics list` to see all topic names

### Example `.env` File

Here's a complete example (with fake values):

```bash
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/cleartask

# JWT
JWT_SECRET=your-jwt-secret-here

# OAuth Providers
GOOGLE_CLIENT_ID=your-google-oauth-client-id
GOOGLE_CLIENT_SECRET=your-google-oauth-client-secret
MICROSOFT_CLIENT_ID=your-microsoft-oauth-client-id
MICROSOFT_CLIENT_SECRET=your-microsoft-oauth-client-secret

# LLM Configuration
OPENAI_API_KEY=your-openai-api-key
REQUESTY_API_KEY=your-requesty-api-key

# Gmail Push Notifications
GMAIL_CLIENT_ID=123456789-abcdefg.apps.googleusercontent.com
GMAIL_CLIENT_SECRET=GOCSPX-AbCdEfGhIjKlMnOpQrStUvWx
GMAIL_REFRESH_TOKEN=1//0gABCDEFGHIJKLMNOPQRSTUVWXYZ
GMAIL_APP_EMAIL=cleartask-app@gmail.com
GCP_PROJECT_ID=cleartask-gmail-integration
GCP_PUBSUB_TOPIC_NAME=projects/cleartask-gmail-integration/topics/gmail-push

# Server
PORT=3000
FRONTEND_URL=http://localhost:5173
```

---

## Application Startup Verification

After configuring environment variables, verify the application starts correctly and initializes Gmail watch.

### 1. Check Database Schema

The application automatically creates the required database table on startup.

**Verify the table exists:**

```sql
-- Connect to your PostgreSQL database
psql -U your_username -d cleartask

-- Check if the table exists
\dt gmail_sync_state

-- View the table structure
\d gmail_sync_state

-- Check current data
SELECT * FROM gmail_sync_state;
```

**Expected table structure:**

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL PRIMARY KEY | Auto-incrementing ID |
| `email_address` | VARCHAR(255) UNIQUE NOT NULL | Gmail account email |
| `history_id` | VARCHAR(255) | Current Gmail history ID |
| `expiration` | BIGINT | Watch expiration timestamp (milliseconds) |
| `updated_at` | TIMESTAMP | Last update timestamp |

**Initial state**: The table should be empty on first startup. After successful watch initialization, you'll see one row with your `GMAIL_APP_EMAIL`.

### 2. Check Application Logs

Start your backend application and monitor the logs:

```bash
cd backend
npm run dev
```

#### Success Messages to Look For:

```
✓ Database connected successfully
✓ Gmail sync state table initialized
✓ Gmail watch initialized successfully with historyId: 123456789
✓ Watch expiration: 2026-01-09T10:00:00.000Z (7 days from now)
✓ Server listening on port 3000
```

#### Configuration Warning (if Gmail not configured):

```
⚠ Gmail push notifications not configured. Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, GMAIL_APP_EMAIL, GCP_PROJECT_ID, and GCP_PUBSUB_TOPIC_NAME in .env
```

If you see this warning, double-check your `.env` file has all required variables.

#### Error Messages and Meanings:

| Error Message | Cause | Solution |
|---------------|-------|----------|
| `Error initializing Gmail watch: invalid_grant` | Refresh token is invalid or expired | Generate a new refresh token (see GCP Setup Guide) |
| `Error initializing Gmail watch: 403` | Gmail API not enabled or insufficient permissions | Enable Gmail API in GCP Console |
| `Error initializing Gmail watch: 404` | Pub/Sub topic doesn't exist | Verify `GCP_PUBSUB_TOPIC_NAME` is correct |
| `Error initializing Gmail watch: PERMISSION_DENIED` | Gmail service account can't publish to topic | Add IAM policy binding (see GCP Setup Guide) |
| `Database connection failed` | PostgreSQL not running or wrong credentials | Check `DATABASE_URL` in `.env` |

### 3. Verify Watch Registration

After successful startup, verify the watch is registered with Gmail:

**Check the database:**

```sql
SELECT * FROM gmail_sync_state;
```

**Expected output:**

| id | email_address | history_id | expiration | updated_at |
|----|---------------|------------|------------|------------|
| 1 | cleartask-app@gmail.com | 123456789 | 1735905600000 | 2026-01-02 09:00:00 |

**Verify in GCP Console:**

1. Navigate to **Pub/Sub > Subscriptions**
2. Click on your subscription (e.g., `gmail-push-sub`)
3. Check the **Metrics** tab
4. You should see the subscription is active (no errors)

---

## Testing the Setup

Let's verify the entire flow works end-to-end.

### 1. Send Test Email

Send an email to your `GMAIL_APP_EMAIL` address:

- **From**: Any email address (preferably one you've authorized in ClearTask)
- **To**: Your `GMAIL_APP_EMAIL` (e.g., `cleartask-app@gmail.com`)
- **Subject**: `Test Gmail Push Notification`
- **Body**: `Create a task: Buy groceries tomorrow`

**Expected timeline**: Notification should arrive within 1-10 seconds.

### 2. Verify Webhook Receives Notifications

Monitor your application logs for webhook activity:

**Expected log messages:**

```
📨 Received Pub/Sub notification
📧 Processing Gmail notification for: cleartask-app@gmail.com
📊 Current historyId: 123456789, New historyId: 123456790
✓ Gmail sync state updated successfully
```

**Webhook request details:**

The webhook at `/email-ingestion/webhook` receives a POST request from Pub/Sub with this structure:

```json
{
  "message": {
    "data": "base64-encoded-data",
    "messageId": "1234567890",
    "publishTime": "2026-01-02T09:00:00.000Z"
  },
  "subscription": "projects/PROJECT_ID/subscriptions/gmail-push-sub"
}
```

The `data` field is base64-encoded JSON:

```json
{
  "emailAddress": "cleartask-app@gmail.com",
  "historyId": "123456790"
}
```

### 3. Verify Email Processing

After the webhook receives the notification, the application fetches and processes new emails.

**Check application logs:**

```
🔍 Fetching Gmail history since historyId: 123456789
📬 Found 1 new message(s)
📧 Processing message ID: abc123def456
✉️ From: sender@example.com
📝 Subject: Test Gmail Push Notification
🔐 Checking if sender is authorized...
✓ Sender is authorized
🤖 Sending to LLM for task extraction...
✅ Task created: Buy groceries tomorrow
```

**Verify in database:**

```sql
-- Check if task was created
SELECT * FROM tasks WHERE title LIKE '%groceries%';

-- Check email processing record
SELECT * FROM processed_emails WHERE message_id = 'abc123def456';
```

### 4. Verify historyId Update

After processing, the `historyId` should be updated:

```sql
SELECT email_address, history_id, updated_at FROM gmail_sync_state;
```

The `history_id` should have increased, and `updated_at` should be recent.

### Common Test Scenarios

#### Scenario A: Authorized Sender
- **Setup**: Add sender's email to authorized senders in ClearTask
- **Expected**: Email is processed, task is created
- **Log**: `✓ Sender is authorized`

#### Scenario B: Unauthorized Sender
- **Setup**: Send from an email not in authorized senders
- **Expected**: Email is received but not processed
- **Log**: `⚠ Sender not authorized: sender@example.com`

#### Scenario C: Multiple Emails
- **Setup**: Send 3 emails in quick succession
- **Expected**: All 3 notifications received and processed
- **Log**: Multiple `📨 Received Pub/Sub notification` messages

#### Scenario D: Duplicate Notification
- **Setup**: Pub/Sub may retry delivery
- **Expected**: Duplicate is detected and ignored
- **Log**: `ℹ Duplicate notification (historyId already processed)`

---

## Watch Renewal

Gmail watch registrations expire after 7 days. The application automatically renews them.

### Automatic Renewal

The application includes a cron scheduler that runs every 6 days to renew the watch before it expires.

**Verify scheduler is running:**

Check application logs on startup:

```
✓ Gmail watch renewal scheduler started (runs every 6 days)
```

**Renewal log messages:**

```
🔄 Running scheduled Gmail watch renewal...
✓ Gmail watch renewed successfully
✓ New expiration: 2026-01-16T10:00:00.000Z
✓ historyId updated: 123456999
```

### Manual Renewal

If needed, you can manually trigger a renewal by restarting the application. The watch is re-initialized on every startup.

**Steps:**

1. Stop the application (Ctrl+C)
2. Start the application again:
   ```bash
   npm run dev
   ```
3. Check logs for successful watch initialization

### Monitoring Renewal

**Check watch expiration in database:**

```sql
SELECT
  email_address,
  to_timestamp(expiration / 1000) AS expiration_time,
  CASE
    WHEN expiration > EXTRACT(EPOCH FROM NOW()) * 1000 THEN 'Active'
    ELSE 'Expired'
  END AS status
FROM gmail_sync_state;
```

**Expected output:**

| email_address | expiration_time | status |
|---------------|----------------|--------|
| cleartask-app@gmail.com | 2026-01-09 10:00:00 | Active |

**Set up monitoring alerts:**

Consider setting up alerts for:
- Watch expiration within 24 hours
- Renewal failures
- Missing renewal log messages

---

## Troubleshooting

### Watch Initialization Fails

#### Problem: "Error initializing Gmail watch: invalid_grant"

**Cause**: Refresh token is invalid, expired, or revoked.

**Solution**:
1. Generate a new refresh token using the [GCP Setup Guide](./GMAIL_PUSH_NOTIFICATIONS_GCP_SETUP.md#4-obtain-gmail-refresh-token)
2. Update `GMAIL_REFRESH_TOKEN` in `.env`
3. Restart the application

**Verification**:
```bash
# Test the refresh token
curl -X POST https://oauth2.googleapis.com/token \
  -d "client_id=$GMAIL_CLIENT_ID" \
  -d "client_secret=$GMAIL_CLIENT_SECRET" \
  -d "refresh_token=$GMAIL_REFRESH_TOKEN" \
  -d "grant_type=refresh_token"
```

#### Problem: "Error initializing Gmail watch: 403 Forbidden"

**Cause**: Gmail API is not enabled or OAuth consent screen not configured.

**Solution**:
1. Go to GCP Console > APIs & Services > Library
2. Search for "Gmail API" and ensure it's enabled
3. Check OAuth consent screen configuration
4. Verify the Gmail account has authorized the application

#### Problem: "Error initializing Gmail watch: PERMISSION_DENIED"

**Cause**: Gmail service account doesn't have permission to publish to Pub/Sub topic.

**Solution**:
1. Follow [Step 6 of the GCP Setup Guide](./GMAIL_PUSH_NOTIFICATIONS_GCP_SETUP.md#6-grant-gmail-api-permission-to-publish)
2. Verify IAM policy:
   ```bash
   gcloud pubsub topics get-iam-policy gmail-push
   ```
3. Should show `gmail-api-push@system.gserviceaccount.com` with `roles/pubsub.publisher`

### Webhook Not Receiving Notifications

#### Problem: No webhook logs after sending test email

**Cause**: Multiple possible causes.

**Diagnostic steps**:

1. **Check if Gmail sent the notification:**
   - GCP Console > Pub/Sub > Topics > `gmail-push`
   - Check the **Metrics** tab for message count
   - If no messages, the watch may not be registered correctly

2. **Check subscription delivery:**
   - GCP Console > Pub/Sub > Subscriptions > `gmail-push-sub`
   - Check **Metrics** tab for delivery attempts
   - Check for error messages

3. **Verify endpoint URL:**
   ```bash
   gcloud pubsub subscriptions describe gmail-push-sub
   ```
   - Ensure `pushConfig.pushEndpoint` is correct
   - For local development, ensure ngrok is running

4. **Test endpoint manually:**
   ```bash
   curl -X POST https://your-domain.com/email-ingestion/webhook \
     -H "Content-Type: application/json" \
     -d '{
       "message": {
         "data": "eyJlbWFpbEFkZHJlc3MiOiJ0ZXN0QGV4YW1wbGUuY29tIiwiaGlzdG9yeUlkIjoiMTIzNDU2In0=",
         "messageId": "test-123",
         "publishTime": "2026-01-02T09:00:00.000Z"
       }
     }'
   ```

5. **Check firewall/security groups:**
   - Ensure your server accepts incoming HTTPS traffic
   - Google Pub/Sub IP ranges must be allowed

#### Problem: Webhook returns 404 or 500 errors

**Cause**: Application routing issue or runtime error.

**Solution**:
1. Verify the route is registered:
   ```javascript
   // In backend/app.js or backend/src/email_ingestion/index.js
   fastify.post('/email-ingestion/webhook', async (request, reply) => {
     // Handler code
   });
   ```
2. Check application logs for errors
3. Test the endpoint locally:
   ```bash
   curl -X POST http://localhost:3000/email-ingestion/webhook \
     -H "Content-Type: application/json" \
     -d '{"message":{"data":"dGVzdA=="}}'
   ```

### Notifications Received But Not Processed

#### Problem: Webhook logs show notifications, but emails aren't processed

**Cause**: Error in email processing logic.

**Diagnostic steps**:

1. **Check for error logs:**
   ```
   ❌ Error processing Gmail notification: [error details]
   ```

2. **Verify historyId is being updated:**
   ```sql
   SELECT email_address, history_id, updated_at FROM gmail_sync_state;
   ```
   - If `updated_at` is old, processing is failing

3. **Check Gmail API quota:**
   - GCP Console > APIs & Services > Dashboard
   - Click on Gmail API
   - Check quota usage
   - Default quota: 1 billion quota units per day (very high)

4. **Test Gmail API access manually:**
   ```bash
   # Get access token
   ACCESS_TOKEN=$(curl -s -X POST https://oauth2.googleapis.com/token \
     -d "client_id=$GMAIL_CLIENT_ID" \
     -d "client_secret=$GMAIL_CLIENT_SECRET" \
     -d "refresh_token=$GMAIL_REFRESH_TOKEN" \
     -d "grant_type=refresh_token" | jq -r '.access_token')
   
   # Test history API
   curl -H "Authorization: Bearer $ACCESS_TOKEN" \
     "https://gmail.googleapis.com/gmail/v1/users/me/history?startHistoryId=123456789"
   ```

#### Problem: Sender authorization check fails

**Cause**: Sender's email not in authorized senders list.

**Solution**:
1. Add sender to authorized senders in ClearTask UI
2. Or check database:
   ```sql
   SELECT * FROM authorized_senders WHERE user_id = YOUR_USER_ID;
   ```
3. Verify email matching logic handles different formats (e.g., `Name <email@example.com>`)

### Watch Expires and Doesn't Renew

#### Problem: Watch expiration passed, no renewal occurred

**Cause**: Renewal scheduler not running or failing.

**Diagnostic steps**:

1. **Check if scheduler is running:**
   - Look for startup log: `✓ Gmail watch renewal scheduler started`
   - If missing, check for errors in scheduler initialization

2. **Check renewal logs:**
   - Search logs for: `Running scheduled Gmail watch renewal`
   - If missing, scheduler may not be triggering

3. **Manually trigger renewal:**
   - Restart the application
   - Watch is re-initialized on startup

4. **Check for renewal errors:**
   ```
   ❌ Error renewing Gmail watch: [error details]
   ```
   - Common causes: expired refresh token, API quota exceeded

**Solution**:
- If refresh token expired, generate a new one
- If scheduler isn't running, check cron configuration in code
- Consider adding monitoring/alerting for watch expiration

---

## Monitoring and Maintenance

### Key Metrics to Track

1. **Watch Status**
   - Current expiration time
   - Time until expiration
   - Last renewal timestamp

2. **Notification Delivery**
   - Pub/Sub message count (GCP Console)
   - Webhook success rate
   - Processing latency

3. **Email Processing**
   - Emails received vs. processed
   - Authorization failures
   - LLM processing errors

### Monitoring Queries

**Check watch health:**

```sql
SELECT
  email_address,
  history_id,
  to_timestamp(expiration / 1000) AS expires_at,
  EXTRACT(EPOCH FROM (to_timestamp(expiration / 1000) - NOW())) / 86400 AS days_until_expiration,
  updated_at
FROM gmail_sync_state;
```

**Check recent email processing:**

```sql
SELECT 
  message_id,
  sender,
  subject,
  processed_at,
  task_created
FROM processed_emails
ORDER BY processed_at DESC
LIMIT 20;
```

### Log Messages to Watch For

**Critical (requires immediate action):**
- `❌ Error initializing Gmail watch`
- `❌ Error renewing Gmail watch`
- `❌ Database connection failed`

**Warning (investigate soon):**
- `⚠ Gmail push notifications not configured`
- `⚠ Watch expires in less than 24 hours`
- `⚠ Sender not authorized`

**Info (normal operation):**
- `✓ Gmail watch initialized successfully`
- `✓ Gmail watch renewed successfully`
- `📨 Received Pub/Sub notification`

### When to Manually Intervene

1. **Watch expiration within 24 hours**: Restart application to renew
2. **Repeated webhook failures**: Check endpoint accessibility
3. **No notifications for extended period**: Verify watch is still active
4. **Refresh token errors**: Generate new refresh token
5. **Pub/Sub quota exceeded**: Review usage and increase quota if needed

### Recommended Monitoring Setup

**Option 1: GCP Cloud Monitoring**

Create alerts for:
- Pub/Sub subscription delivery failures
- High error rates on webhook endpoint
- Pub/Sub message age (indicates processing delays)

**Option 2: Application-Level Monitoring**

Implement health check endpoint:

```javascript
fastify.get('/health/gmail-watch', async (request, reply) => {
  const syncState = await db.query(
    'SELECT * FROM gmail_sync_state WHERE email_address = $1',
    [process.env.GMAIL_APP_EMAIL]
  );
  
  if (!syncState.rows[0]) {
    return reply.code(503).send({ status: 'unhealthy', reason: 'Watch not initialized' });
  }
  
  const expiration = parseInt(syncState.rows[0].expiration);
  const now = Date.now();
  const hoursUntilExpiration = (expiration - now) / (1000 * 60 * 60);
  
  if (hoursUntilExpiration < 24) {
    return reply.code(503).send({ 
      status: 'unhealthy', 
      reason: 'Watch expires soon',
      hoursUntilExpiration 
    });
  }
  
  return reply.send({ 
    status: 'healthy',
    hoursUntilExpiration,
    lastUpdate: syncState.rows[0].updated_at
  });
});
```

---

## Local Development Setup

### Using ngrok for Local HTTPS Endpoint

Pub/Sub push subscriptions require HTTPS endpoints. For local development, use ngrok.

#### 1. Install ngrok

Download from [ngrok.com/download](https://ngrok.com/download) or use a package manager:

```bash
# macOS
brew install ngrok

# Windows (Chocolatey)
choco install ngrok

# Linux (Snap)
snap install ngrok
```

#### 2. Start Your Backend

```bash
cd backend
npm run dev
```

Your backend should be running on `http://localhost:3000` (or your configured port).

#### 3. Start ngrok

In a new terminal:

```bash
ngrok http 3000
```

**Output:**

```
ngrok by @inconshreveable

Session Status                online
Account                       your-account (Plan: Free)
Version                       3.0.0
Region                        United States (us)
Forwarding                    https://abc123.ngrok.io -> http://localhost:3000
```

**Important**: Copy the HTTPS URL (e.g., `https://abc123.ngrok.io`)

#### 4. Update Pub/Sub Subscription

Update your push subscription endpoint:

```bash
gcloud pubsub subscriptions modify gmail-push-sub \
  --push-endpoint=https://abc123.ngrok.io/email-ingestion/webhook
```

**Verify:**

```bash
gcloud pubsub subscriptions describe gmail-push-sub
```

Should show:

```yaml
pushConfig:
  pushEndpoint: https://abc123.ngrok.io/email-ingestion/webhook
```

#### 5. Test the Setup

Send a test email to your `GMAIL_APP_EMAIL` and watch both:
- Your application logs
- ngrok web interface at `http://localhost:4040`

The ngrok interface shows all HTTP requests, which is helpful for debugging.

### Handling ngrok URL Changes

**Problem**: Free ngrok URLs change every time you restart ngrok.

**Solutions**:

**Option A: Paid ngrok Plan**
- Get a static domain
- No need to update subscription endpoint

**Option B: Automation Script**

Create `update-ngrok-endpoint.sh`:

```bash
#!/bin/bash

# Get current ngrok URL
NGROK_URL=$(curl -s http://localhost:4040/api/tunnels | jq -r '.tunnels[0].public_url')

if [ -z "$NGROK_URL" ]; then
  echo "Error: ngrok not running or no tunnels found"
  exit 1
fi

echo "Current ngrok URL: $NGROK_URL"

# Update Pub/Sub subscription
gcloud pubsub subscriptions modify gmail-push-sub \
  --push-endpoint=$NGROK_URL/email-ingestion/webhook

echo "✓ Push endpoint updated successfully"
```

Make it executable and run after starting ngrok:

```bash
chmod +x update-ngrok-endpoint.sh
./update-ngrok-endpoint.sh
```

**Option C: Use a Development Server**

Deploy to a development server with a static domain (e.g., Heroku, Railway, Render).

### Testing Without Exposing Local Machine

If you can't use ngrok or prefer not to expose your local machine:

1. **Deploy to a staging environment** with a public HTTPS endpoint
2. **Use GCP Cloud Run** for quick deployments
3. **Use a development VM** in GCP with a public IP

---

## Next Steps

Now that your Gmail push notifications are configured:

1. **Test thoroughly**: Send various types of emails and verify processing
2. **Set up monitoring**: Implement health checks and alerts
3. **Document your setup**: Keep notes on your specific configuration
4. **Plan for production**: Consider scaling, redundancy, and disaster recovery

---

## Additional Resources

- [Gmail API Push Notifications Documentation](https://developers.google.com/gmail/api/guides/push)
- [Cloud Pub/Sub Push Subscriptions](https://cloud.google.com/pubsub/docs/push)
- [OAuth 2.0 for Server-Side Web Apps](https://developers.google.com/identity/protocols/oauth2/web-server)
- [ngrok Documentation](https://ngrok.com/docs)
- [ClearTask Email Ingestion PRD](./FEATURE_AI_EMAIL_INGESTION_PRD.md)
- [ClearTask Email Ingestion Implementation Plan](./AI_EMAIL_INGESTION_IMPLEMENTATION_PLAN.md)

---

**Need Help?** If you encounter issues not covered in this guide, check the [ClearTask GitHub Issues](https://github.com/your-repo/cleartask/issues) or create a new issue with:
- Your environment details (OS, Node version, etc.)
- Relevant log messages
- Steps to reproduce the issue
- What you've already tried

# Gmail Push Notifications - Google Cloud Platform Setup Guide

This guide walks you through configuring Google Cloud Platform (GCP) to enable Gmail push notifications for the ClearTask application.

## Table of Contents
- [Prerequisites](#prerequisites)
- [Step-by-Step Instructions](#step-by-step-instructions)
  - [1. Create or Select a GCP Project](#1-create-or-select-a-gcp-project)
  - [2. Enable Required APIs](#2-enable-required-apis)
  - [3. Create OAuth 2.0 Credentials](#3-create-oauth-20-credentials)
  - [4. Obtain Gmail Refresh Token](#4-obtain-gmail-refresh-token)
  - [5. Create Pub/Sub Topic](#5-create-pubsub-topic)
  - [6. Grant Gmail API Permission to Publish](#6-grant-gmail-api-permission-to-publish)
  - [7. Create Push Subscription](#7-create-push-subscription)
  - [8. Verify Configuration](#8-verify-configuration)
- [Security Considerations](#security-considerations)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

Before starting, ensure you have:

- **Google Cloud Platform account**: Sign up at [cloud.google.com](https://cloud.google.com)
- **Gmail account**: The Gmail account that will receive emails for task creation
- **gcloud CLI** (optional but recommended): Install from [cloud.google.com/sdk/docs/install](https://cloud.google.com/sdk/docs/install)
- **Basic understanding of OAuth 2.0**: Helpful but not required

---

## Step-by-Step Instructions

### 1. Create or Select a GCP Project

Every GCP resource belongs to a project. You'll need to create a new project or use an existing one.

#### Using GCP Console (Web UI):

1. Navigate to [console.cloud.google.com](https://console.cloud.google.com)
2. Click the project dropdown at the top of the page
3. Click **"New Project"**
4. Enter a project name (e.g., `cleartask-gmail-integration`)
5. Select a billing account (required for API usage)
6. Click **"Create"**
7. **Important**: Note your **Project ID** (shown below the project name) - you'll need this later

> **Screenshot Description**: GCP Console showing the "New Project" dialog with fields for project name and organization.

#### Using gcloud CLI:

```bash
# Create a new project
gcloud projects create cleartask-gmail-integration --name="ClearTask Gmail Integration"

# Set as the active project
gcloud config set project cleartask-gmail-integration
```

---

### 2. Enable Required APIs

You need to enable two APIs: Gmail API and Cloud Pub/Sub API.

#### Using GCP Console (Web UI):

1. In the GCP Console, navigate to **"APIs & Services" > "Library"**
2. Search for **"Gmail API"**
3. Click on it and click **"Enable"**
4. Go back to the Library
5. Search for **"Cloud Pub/Sub API"**
6. Click on it and click **"Enable"**

> **Screenshot Description**: GCP Console showing the API Library with Gmail API search results.

#### Using gcloud CLI:

```bash
# Enable Gmail API
gcloud services enable gmail.googleapis.com

# Enable Cloud Pub/Sub API
gcloud services enable pubsub.googleapis.com
```

**Verification**: You can verify enabled APIs with:
```bash
gcloud services list --enabled
```

---

### 3. Create OAuth 2.0 Credentials

OAuth 2.0 credentials allow your application to access Gmail on behalf of a user.

#### Using GCP Console (Web UI):

1. Navigate to **"APIs & Services" > "Credentials"**
2. Click **"+ CREATE CREDENTIALS"** at the top
3. Select **"OAuth client ID"**
4. If prompted to configure the OAuth consent screen:
   - Click **"Configure Consent Screen"**
   - Select **"External"** (or "Internal" if using Google Workspace)
   - Fill in required fields:
     - App name: `ClearTask`
     - User support email: Your email
     - Developer contact email: Your email
   - Click **"Save and Continue"**
   - On the Scopes page, click **"Add or Remove Scopes"**
   - Add the following scope: `https://www.googleapis.com/auth/gmail.readonly`
   - Click **"Update"** and **"Save and Continue"**
   - Add test users if using External type (add the Gmail account you'll use)
   - Click **"Save and Continue"**
5. Back on the Credentials page, click **"+ CREATE CREDENTIALS" > "OAuth client ID"** again
6. Select **"Web application"** as the application type
7. Enter a name: `ClearTask Backend`
8. Under **"Authorized redirect URIs"**, add:
   - For OAuth Playground method: `https://developers.google.com/oauthplayground`
   - For your application: `http://localhost:3000/auth/callback` (adjust port if needed)
9. Click **"Create"**
10. **Important**: A dialog will show your **Client ID** and **Client Secret**
    - Copy both values immediately
    - You can also download the JSON file for safekeeping
    - Store these securely - you'll need them for the application configuration

> **Screenshot Description**: GCP Console showing the OAuth client created dialog with Client ID and Client Secret displayed.

> ⚠️ **Security Warning**: Never commit your Client Secret to version control. Store it in environment variables or a secure secrets manager.

---

### 4. Obtain Gmail Refresh Token

The refresh token allows your application to access Gmail without repeated user authentication.

#### Method A: Using OAuth 2.0 Playground (Recommended for Beginners)

1. Go to [OAuth 2.0 Playground](https://developers.google.com/oauthplayground)
2. Click the **gear icon** (⚙️) in the top right to open settings
3. Check **"Use your own OAuth credentials"**
4. Enter your **OAuth Client ID** and **OAuth Client Secret** from Step 3
5. Close the settings
6. In the left panel under **"Step 1 - Select & authorize APIs"**:
   - Scroll down to **"Gmail API v1"**
   - Expand it and select: `https://www.googleapis.com/auth/gmail.readonly`
7. Click **"Authorize APIs"**
8. Sign in with the Gmail account you want to use for the app
9. Click **"Allow"** to grant permissions
10. You'll be redirected back to the playground
11. In **"Step 2 - Exchange authorization code for tokens"**, click **"Exchange authorization code for tokens"**
12. **Important**: Copy the **Refresh token** value - you'll need this for the application configuration

> **Screenshot Description**: OAuth 2.0 Playground showing Step 2 with the refresh token displayed.

#### Method B: Using a Node.js Script

If you prefer a programmatic approach, create a temporary script:

```javascript
// get-refresh-token.js
import { google } from 'googleapis';
import readline from 'readline';

const oauth2Client = new google.auth.OAuth2(
  'YOUR_CLIENT_ID',
  'YOUR_CLIENT_SECRET',
  'http://localhost:3000/auth/callback' // Must match your redirect URI
);

const scopes = ['https://www.googleapis.com/auth/gmail.readonly'];

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: scopes,
  prompt: 'consent' // Force to get refresh token
});

console.log('Authorize this app by visiting this url:', authUrl);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.question('Enter the code from that page here: ', async (code) => {
  rl.close();
  try {
    const { tokens } = await oauth2Client.getToken(code);
    console.log('Refresh Token:', tokens.refresh_token);
    console.log('\nSave this refresh token securely!');
  } catch (error) {
    console.error('Error retrieving access token', error);
  }
});
```

Run the script:
```bash
node get-refresh-token.js
```

#### Testing the Refresh Token

You can verify your refresh token works:

```bash
curl -X POST https://oauth2.googleapis.com/token \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "client_secret=YOUR_CLIENT_SECRET" \
  -d "refresh_token=YOUR_REFRESH_TOKEN" \
  -d "grant_type=refresh_token"
```

If successful, you'll receive a new access token in the response.

---

### 5. Create Pub/Sub Topic

A Pub/Sub topic is where Gmail will publish notification messages.

#### Using GCP Console (Web UI):

1. Navigate to **"Pub/Sub" > "Topics"** in the GCP Console
2. Click **"+ CREATE TOPIC"**
3. Enter a Topic ID: `gmail-push` (you can use a different name if preferred)
4. Leave other settings as default
5. Click **"Create"**
6. **Important**: Note the full topic name format: `projects/YOUR_PROJECT_ID/topics/gmail-push`

> **Screenshot Description**: GCP Console showing the Create Topic dialog with the topic ID field.

#### Using gcloud CLI:

```bash
# Create the topic
gcloud pubsub topics create gmail-push

# Verify creation
gcloud pubsub topics list
```

The full topic name will be: `projects/YOUR_PROJECT_ID/topics/gmail-push`

---

### 6. Grant Gmail API Permission to Publish

Gmail needs permission to publish messages to your Pub/Sub topic.

#### Using GCP Console (Web UI):

1. Navigate to **"Pub/Sub" > "Topics"**
2. Click on your `gmail-push` topic
3. Click the **"PERMISSIONS"** tab
4. Click **"+ ADD PRINCIPAL"**
5. In the "New principals" field, enter: `gmail-api-push@system.gserviceaccount.com`
6. In the "Select a role" dropdown, search for and select: **"Pub/Sub Publisher"**
7. Click **"Save"**

> **Screenshot Description**: GCP Console showing the Add Principal dialog with the Gmail service account and Pub/Sub Publisher role.

#### Using gcloud CLI:

```bash
gcloud pubsub topics add-iam-policy-binding gmail-push \
  --member=serviceAccount:gmail-api-push@system.gserviceaccount.com \
  --role=roles/pubsub.publisher
```

**Verification**: Check the IAM policy:
```bash
gcloud pubsub topics get-iam-policy gmail-push
```

You should see the Gmail service account listed with the `roles/pubsub.publisher` role.

---

### 7. Create Push Subscription

A push subscription delivers Pub/Sub messages to your application's webhook endpoint.

#### Important: Endpoint URL Requirements

- **Production**: Must use HTTPS with a valid SSL certificate
- **Local Development**: Use a tunneling service like [ngrok](https://ngrok.com/) to expose your local server

Your endpoint URL format: `https://your-domain.com/email-ingestion/webhook`

#### For Local Development with ngrok:

1. Install ngrok: [ngrok.com/download](https://ngrok.com/download)
2. Start your backend server locally (e.g., on port 3000)
3. In a new terminal, run:
   ```bash
   ngrok http 3000
   ```
4. ngrok will provide a public HTTPS URL (e.g., `https://abc123.ngrok.io`)
5. Your webhook endpoint will be: `https://abc123.ngrok.io/email-ingestion/webhook`

> ⚠️ **Note**: ngrok URLs change each time you restart ngrok (unless you have a paid plan). You'll need to update the subscription endpoint each time.

#### Using GCP Console (Web UI):

1. Navigate to **"Pub/Sub" > "Subscriptions"**
2. Click **"+ CREATE SUBSCRIPTION"**
3. Enter a Subscription ID: `gmail-push-sub`
4. Select your topic: `gmail-push`
5. Under **"Delivery type"**, select **"Push"**
6. Enter your **Endpoint URL**: `https://your-domain.com/email-ingestion/webhook`
7. Leave other settings as default (or adjust as needed):
   - Acknowledgement deadline: 10 seconds (default)
   - Message retention duration: 7 days (default)
8. Click **"Create"**

> **Screenshot Description**: GCP Console showing the Create Subscription dialog with Push delivery type selected and endpoint URL field.

#### Using gcloud CLI:

```bash
# For production
gcloud pubsub subscriptions create gmail-push-sub \
  --topic=gmail-push \
  --push-endpoint=https://your-domain.com/email-ingestion/webhook

# For local development with ngrok
gcloud pubsub subscriptions create gmail-push-sub \
  --topic=gmail-push \
  --push-endpoint=https://abc123.ngrok.io/email-ingestion/webhook
```

#### Updating the Push Endpoint (for local development):

If your ngrok URL changes, update the subscription:

```bash
gcloud pubsub subscriptions modify gmail-push-sub \
  --push-endpoint=https://new-ngrok-url.ngrok.io/email-ingestion/webhook
```

---

### 8. Verify Configuration

Let's verify everything is set up correctly.

#### Check Topic and Subscription:

**Using GCP Console:**
1. Navigate to **"Pub/Sub" > "Topics"**
2. Verify `gmail-push` topic exists
3. Click on it and check the **"PERMISSIONS"** tab
4. Verify `gmail-api-push@system.gserviceaccount.com` has Publisher role
5. Navigate to **"Pub/Sub" > "Subscriptions"**
6. Verify `gmail-push-sub` subscription exists
7. Click on it and verify the push endpoint URL is correct

**Using gcloud CLI:**
```bash
# List topics
gcloud pubsub topics list

# Check topic permissions
gcloud pubsub topics get-iam-policy gmail-push

# List subscriptions
gcloud pubsub subscriptions list

# Check subscription details
gcloud pubsub subscriptions describe gmail-push-sub
```

#### Test Pub/Sub Message Delivery:

You can manually publish a test message to verify the subscription delivers to your endpoint:

```bash
gcloud pubsub topics publish gmail-push --message="test message"
```

Check your application logs to see if the webhook received the message.

#### Verify Gmail API Access:

Test that your OAuth credentials and refresh token work:

```bash
# First, get an access token
ACCESS_TOKEN=$(curl -s -X POST https://oauth2.googleapis.com/token \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "client_secret=YOUR_CLIENT_SECRET" \
  -d "refresh_token=YOUR_REFRESH_TOKEN" \
  -d "grant_type=refresh_token" | jq -r '.access_token')

# Then, test Gmail API access
curl -H "Authorization: Bearer $ACCESS_TOKEN" \
  https://gmail.googleapis.com/gmail/v1/users/me/profile
```

You should receive a JSON response with the Gmail profile information.

#### Common Issues:

- **403 Forbidden on Pub/Sub publish**: Gmail service account doesn't have Publisher role
- **404 Not Found on webhook**: Endpoint URL is incorrect or application isn't running
- **401 Unauthorized on Gmail API**: Refresh token is invalid or expired
- **Subscription shows delivery errors**: Check application logs and ensure endpoint is accessible

---

## Security Considerations

### Protect Your Credentials

- **Never commit credentials to version control**: Use `.gitignore` to exclude `.env` files
- **Use environment variables**: Store all sensitive values in environment variables
- **Restrict OAuth scopes**: Only request the minimum scopes needed (`gmail.readonly`)
- **Use service accounts for production**: Consider using GCP service accounts with domain-wide delegation for production deployments

### Rotate Credentials Regularly

- **Refresh tokens**: Rotate every 6-12 months
- **OAuth client secrets**: Rotate annually or if compromised
- **Monitor access**: Regularly review OAuth consent screen and authorized applications

### Monitor Pub/Sub Usage

- **Set up billing alerts**: Pub/Sub has quotas and costs
- **Monitor message delivery**: Check for failed deliveries in GCP Console
- **Review IAM permissions**: Regularly audit who has access to your Pub/Sub resources

### Secure Your Webhook Endpoint

- **Use HTTPS**: Required for production
- **Validate Pub/Sub messages**: Verify messages come from Google (see application setup guide)
- **Implement rate limiting**: Protect against abuse
- **Monitor for anomalies**: Set up logging and alerting

---

## Troubleshooting

### Gmail API Errors

#### Error: "Invalid grant" when using refresh token

**Cause**: Refresh token has expired or been revoked.

**Solution**:
1. Go back to [Step 4](#4-obtain-gmail-refresh-token) and generate a new refresh token
2. Update your application's `.env` file with the new token
3. Restart your application

#### Error: "Access denied" when calling Gmail API

**Cause**: OAuth consent screen hasn't been approved or user hasn't granted permissions.

**Solution**:
1. Check OAuth consent screen status in GCP Console
2. Ensure the Gmail account has authorized the application
3. Verify the correct scopes are requested (`gmail.readonly`)

### Pub/Sub Errors

#### Error: "Permission denied" when Gmail tries to publish

**Cause**: Gmail service account doesn't have Publisher role on the topic.

**Solution**:
1. Go back to [Step 6](#6-grant-gmail-api-permission-to-publish)
2. Verify the IAM policy binding:
   ```bash
   gcloud pubsub topics get-iam-policy gmail-push
   ```
3. Re-add the binding if missing

#### Subscription shows delivery errors

**Cause**: Webhook endpoint is unreachable or returning errors.

**Solution**:
1. Verify your application is running
2. Check that the endpoint URL is correct
3. For local development, ensure ngrok is running
4. Check application logs for errors
5. Test the endpoint manually:
   ```bash
   curl -X POST https://your-domain.com/email-ingestion/webhook \
     -H "Content-Type: application/json" \
     -d '{"message":{"data":"dGVzdA=="}}'
   ```

#### Messages not being delivered to webhook

**Cause**: Multiple possible causes.

**Solution**:
1. Check subscription status in GCP Console:
   - Navigate to **"Pub/Sub" > "Subscriptions"**
   - Click on `gmail-push-sub`
   - Check for error messages
2. Verify the push endpoint URL is correct
3. Check if your firewall/security group allows incoming traffic from Google's IP ranges
4. Review Pub/Sub logs:
   ```bash
   gcloud logging read "resource.type=pubsub_subscription AND resource.labels.subscription_id=gmail-push-sub" --limit 50
   ```

### Verification Issues

#### Can't verify if setup is working

**Solution**:
1. Send a test email to your Gmail account
2. Check GCP Console **"Pub/Sub" > "Topics" > "gmail-push"** for message count
3. Check **"Pub/Sub" > "Subscriptions" > "gmail-push-sub"** for delivery attempts
4. Review application logs for webhook activity
5. Use GCP Cloud Logging to view Pub/Sub delivery logs

### Local Development Issues

#### ngrok URL keeps changing

**Solution**:
- Use a paid ngrok plan for a static URL
- Or, create a script to automatically update the subscription endpoint:
  ```bash
  #!/bin/bash
  NEW_URL=$(curl -s http://localhost:4040/api/tunnels | jq -r '.tunnels[0].public_url')
  gcloud pubsub subscriptions modify gmail-push-sub \
    --push-endpoint=$NEW_URL/email-ingestion/webhook
  echo "Updated push endpoint to: $NEW_URL/email-ingestion/webhook"
  ```

#### Can't access localhost from Pub/Sub

**Cause**: Pub/Sub can't reach `localhost` or `127.0.0.1`.

**Solution**:
- You must use a tunneling service like ngrok to expose your local server
- Alternatively, deploy to a cloud environment for testing

---

## Next Steps

Once you've completed this GCP setup, proceed to the [ClearTask Application Setup Guide](./GMAIL_PUSH_NOTIFICATIONS_APP_SETUP.md) to configure your application.

---

## Additional Resources

- [Gmail API Documentation](https://developers.google.com/gmail/api)
- [Cloud Pub/Sub Documentation](https://cloud.google.com/pubsub/docs)
- [OAuth 2.0 Documentation](https://developers.google.com/identity/protocols/oauth2)
- [Gmail Push Notifications Guide](https://developers.google.com/gmail/api/guides/push)
- [ngrok Documentation](https://ngrok.com/docs)

---

**Need Help?** If you encounter issues not covered in this guide, check the [ClearTask GitHub Issues](https://github.com/your-repo/cleartask/issues) or create a new issue with details about your problem.

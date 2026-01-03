# ClearTask

ClearTask is a revolutionary task management application designed to streamline your daily workflow, with a strong focus on accessibility for low-vision users. It combines cutting-edge technologies, including an intuitive interface with high contrast and large text, intelligent voice commands, and task creation via AI email parsing, to help everyone stay organized and productive.

## Goal and Purpose

The primary goal of ClearTask is to simplify task management, especially for low-vision users, by leveraging natural language processing and voice recognition, alongside high-contrast elements and large text for improved readability. Users can effortlessly create, update, and manage tasks using spoken commands and have AI pull tasks from emails, minimizing the need for manual input and maximizing efficiency. ClearTask aims to provide a seamless and natural interaction experience, making task management less of a chore and more of an integrated part of your day, with a strong emphasis on accessibility.

## Features

*   **Voice-Activated Task Management**: Create, update, and complete tasks using simple voice commands.
*   **Intelligent Task Parsing**: The backend utilizes advanced LLM (Large Language Model) capabilities to understand and process complex voice requests, extracting due dates, descriptions, and task names.
*   **OAuth Integration**: Secure login and authentication via Google and Microsoft OAuth, ensuring your data is protected.
*   **Email Ingestion**: Seamlessly convert emails forwarded to a gmail account, watched by the app, into tasks using Gmail Push Notifications. See the setup guide below for details.
*   **Designed for Low-Vision Users**: Features like clear typography (Atkinson Hyperlegible font), high contrast elements, and voice-driven interaction are prioritized to enhance accessibility for users with low vision.
*   **Intuitive User Interface**: A clean and responsive frontend built with React and TypeScript for an optimal user experience.
*   **Offline Support**: Tasks are managed client-side using Dexie.js for IndexedDB storage, enabling offline access and synchronization.
*   **Haptic and Audio Feedback**: Custom feedback mechanisms enhance user interaction and provide immediate confirmation for actions.
*   **Robust Backend**: Powered by Node.js, Fastify, and PostgreSQL, ensuring scalability and reliability.
*   **LLM Fallback Mechanism**: A multi-tiered LLM system (Requesty.ai -> OpenAI -> text-based fallback) ensures resilience in voice command processing.
*   **Strict Type Safety**: Frontend and backend developed with TypeScript, enforcing strict type checking for fewer bugs and improved maintainability.

## Deployment Guide with Docker

This guide will walk you through setting up and deploying ClearTask using Docker and Docker Compose.

### Prerequisites

*   **Docker and Docker Compose**: Ensure Docker Desktop is installed and running on your system. You can download it from [docker.com](https://www.docker.com/products/docker-desktop/).
*   **Git**: For cloning the repository.

### Steps

1.  **Clone the Repository**:
    ```bash
    git clone https://github.com/your-username/cleartask.git
    cd cleartask
    ```

2.  **Environment Configuration**:
    Create a `.env` file in the root directory of the project. This file will contain all necessary environment variables. Refer to the `.env.example` file for a template. Detailed setup for each service is provided in the "Environment Variable Setup" section below.

3.  **Build and Run with Docker Compose**:
    Once your `.env` file is configured, you can build and start the services:
    ```bash
    docker-compose up --build
    ```
    This command will:
    *   Build the Docker images for both the frontend and backend services.
    *   Start the PostgreSQL database, backend API, and frontend application.
    *   The frontend will typically be accessible at `http://localhost:3000` and the backend API at `http://localhost:3001`.

### Gmail Push Notifications Configuration

ClearTask supports Gmail Push Notifications to automatically ingest emails and convert them into tasks. This requires configuration in both Google Cloud Platform (GCP) and within your application's environment variables.

#### Google Cloud Platform (GCP) Setup for Gmail Push Notifications

1.  **Create or Select a GCP Project**:
    *   Navigate to [console.cloud.google.com](https://console.cloud.google.com).
    *   Create a new project or select an existing one. Note your **Project ID**.

2.  **Enable Required APIs**:
    *   In GCP Console, go to **"APIs & Services" > "Library"**.
    *   Search for and enable **"Gmail API"** and **"Cloud Pub/Sub API"**.

3.  **Create OAuth 2.0 Credentials**:
    *   Go to **"APIs & Services" > "Credentials"**.
    *   Click **"+ CREATE CREDENTIALS" > "OAuth client ID"**.
    *   Configure the OAuth consent screen if prompted (User Type: External/Internal, App Name: `ClearTask`, add your email for User support and Developer contact).
    *   Add the scope: `https://www.googleapis.com/auth/gmail.readonly`.
    *   Create "OAuth client ID" of type "Web application".
    *   **Authorized redirect URIs**:
        *   `https://developers.google.com/oauthplayground`
        *   `http://localhost:3001/auth/callback` (adjust port if needed)
    *   Copy your **Client ID** and **Client Secret**.

4.  **Obtain Gmail Refresh Token**:
    *   Go to [OAuth 2.0 Playground](https://developers.google.com/oauthplayground).
    *   Click the **gear icon** (⚙️), check "Use your own OAuth credentials", and enter your Client ID and Client Secret.
    *   In "Step 1", add scope: `https://www.googleapis.com/auth/gmail.readonly` and click "Authorize APIs".
    *   Sign in with the Gmail account you want to use for the app and grant permissions.
    *   In "Step 2", click "Exchange authorization code for tokens" and copy the **Refresh token**.

5.  **Create Pub/Sub Topic**:
    *   In GCP Console, navigate to **"Pub/Sub" > "Topics"**.
    *   Click **"+ CREATE TOPIC"** and enter a Topic ID (e.g., `gmail-push`).
    *   Note the full topic name: `projects/YOUR_PROJECT_ID/topics/gmail-push`.

6.  **Grant Gmail API Permission to Publish**:
    *   In **"Pub/Sub" > "Topics"**, click on your `gmail-push` topic.
    *   Go to the **"PERMISSIONS"** tab and click **"+ ADD PRINCIPAL"**.
    *   New principals: `gmail-api-push@system.gserviceaccount.com`
    *   Role: **"Pub/Sub Publisher"**.

7.  **Create Push Subscription**:
    *   In **"Pub/Sub" > "Subscriptions"**, click **"+ CREATE SUBSCRIPTION"**.
    *   Enter a Subscription ID (e.g., `gmail-push-sub`).
    *   Select your topic: `gmail-push`.
    *   Delivery type: **"Push"**.
    *   **Endpoint URL**: `https://your-domain.com/email-ingestion/webhook` (For local development, use a tunneling service like [ngrok](https://ngrok.com/) to expose your local server. e.g., `https://abc123.ngrok.io/email-ingestion/webhook`).

#### Application Environment Variable Configuration for Gmail Push Notifications

Add the following variables to your `.env` file:

```dotenv
# ============================================
# Gmail API Configuration
# ============================================

# OAuth 2.0 Client ID from GCP Console
# Location: GCP Console > APIs & Services > Credentials
GMAIL_CLIENT_ID="your_client_id_from_gcp"

# OAuth 2.0 Client Secret from GCP Console
# Location: GCP Console > APIs & Services > Credentials
GMAIL_CLIENT_SECRET="your_client_secret_from_gcp"

# Refresh Token obtained via OAuth 2.0 Playground or script
# This token allows the app to access Gmail without repeated user login
GMAIL_REFRESH_TOKEN="your_refresh_token"

# The Gmail account that will receive emails for task creation
# This should be the same account used to generate the refresh token
GMAIL_APP_EMAIL="your-app-email@gmail.com"

# ============================================
# Google Cloud Pub/Sub Configuration
# ============================================

# Your GCP Project ID
# Location: GCP Console > Project dropdown
GCP_PROJECT_ID="your-gcp-project-id"

# Full Pub/Sub topic name (not just the topic ID)
# Format: projects/YOUR_PROJECT_ID/topics/TOPIC_NAME
GCP_PUBSUB_TOPIC_NAME="projects/your-gcp-project-id/topics/gmail-push"
```

---

### Verify Gmail Push Notification Setup

After configuring, verify the application starts correctly and initializes Gmail watch.

1.  **Check Database Schema**:
    The application automatically creates the `gmail_sync_state` table on startup.
    ```sql
    -- Connect to your PostgreSQL database
    psql -U your_username -d cleartask
    \dt gmail_sync_state
    SELECT * FROM gmail_sync_state;
    ```
    Expected: Table exists. After successful watch initialization, one row with `GMAIL_APP_EMAIL`.

2.  **Check Application Logs**:
    Start your backend (`cd backend && npm run dev`) and look for:
    *   `✓ Gmail watch initialized successfully with historyId: ...`
    *   `✓ Watch expiration: ...`
    *   `⚠ Gmail push notifications not configured` (if variables are missing)

3.  **Verify Watch Registration**:
    *   Check `gmail_sync_state` table in DB for `history_id` and `expiration`.
    *   In GCP Console > Pub/Sub > Subscriptions > `gmail-push-sub`, check the **Metrics** tab for activity.

---

### Testing Gmail Push Notifications

1.  **Send Test Email**:
    Send an email to your `GMAIL_APP_EMAIL` (e.g., `cleartask-app@gmail.com`) with a subject like "Create a task: Buy groceries tomorrow".

2.  **Verify Webhook Receives Notifications**:
    Monitor application logs for `📨 Received Pub/Sub notification` and `📧 Processing Gmail notification for: ...`.

3.  **Verify Email Processing**:
    Look for logs: `🔍 Fetching Gmail history...`, `📬 Found 1 new message(s)`, `✅ Task created: ...`.
    Verify in DB: `SELECT * FROM tasks WHERE title LIKE '%groceries%';`

4.  **Verify historyId Update**:
    `SELECT email_address, history_id, updated_at FROM gmail_sync_state;`
    `history_id` should be updated, `updated_at` should be recent.

---

### Watch Renewal

Gmail watch registrations expire after 7 days. The application automatically renews them.

*   **Automatic Renewal**: The application includes a cron scheduler that runs every 6 days. Look for `🔄 Running scheduled Gmail watch renewal...` in logs.
*   **Manual Renewal**: Restarting the application re-initializes the watch.

---

### Troubleshooting Gmail Push Notifications

*   **`invalid_grant` error**: Refresh token is invalid/expired. Generate a new one from [OAuth 2.0 Playground](https://developers.google.com/oauthplayground).
*   **`403 Forbidden`**: Gmail API not enabled or OAuth consent screen not configured. Enable API in GCP, check consent screen.
*   **`PERMISSION_DENIED`**: Gmail service account lacks `Pub/Sub Publisher` role. Grant the role in GCP IAM.
*   **No webhook logs**: Check Pub/Sub topic metrics, subscription delivery, and endpoint URL (especially if using ngrok).
*   **Notifications received but not processed**: Check application logs for email processing errors.
*   **Watch expires and doesn't renew**: Verify scheduler is running and look for renewal errors in logs.

## Environment Variable Setup (`.env`)

The `.env` file is crucial for configuring your ClearTask instance. Below are the key variables and how to obtain their values.

### General Configuration

*   `NODE_ENV`: `development` or `production`
*   `PORT`: Port for the backend service (e.g., `3001`)
*   `FRONTEND_URL`: URL of your frontend application (e.g., `http://localhost:3000`)

### Database Configuration (PostgreSQL)

*   `PGUSER`: PostgreSQL user (e.g., `cleartask_user`)
*   `PGHOST`: PostgreSQL host (e.g., `localhost` or the Docker service name, typically `db`)
*   `PGDATABASE`: PostgreSQL database name (e.g., `cleartask_db`)
*   `PGPASSWORD`: PostgreSQL password (e.g., `your_db_password`)
*   `PGPORT`: PostgreSQL port (e.g., `5432`)

### Authentication (Google & Microsoft OAuth)

ClearTask uses OAuth for user authentication. You'll need to set up applications in both Google Cloud and Azure.

#### Google Cloud Platform (GCP)

1.  **Create a Project**: Go to the [Google Cloud Console](https://console.cloud.google.com/) and create a new project.
2.  **Enable APIs**: Enable the `Google People API` and `Gmail API`.
3.  **OAuth Consent Screen**: Configure your OAuth consent screen, setting the application type to "External" if you plan to share it, or "Internal" for organizational use.
4.  **Create OAuth Client ID**: Navigate to "APIs & Services" > "Credentials". Create "OAuth client ID" credentials:
    *   **Application type**: "Web application"
    *   **Authorized JavaScript origins**: Add your frontend URL (e.g., `http://localhost:3000`).
    *   **Authorized redirect URIs**: Add `http://localhost:3001/api/auth/google/callback` (replace `3001` with your backend port if different).
5.  **Copy Credentials**: Note down your Client ID and Client Secret.

    ```dotenv
    GOOGLE_CLIENT_ID="YOUR_GOOGLE_CLIENT_ID"
    GOOGLE_CLIENT_SECRET="YOUR_GOOGLE_CLIENT_SECRET"
    ```

#### Microsoft Azure Active Directory

1.  **Register an Application**: Go to the [Azure portal](https://portal.azure.com/) > Azure Active Directory > App registrations. Click "New registration".
2.  **Configure Application**:
    *   Give your application a name.
    *   For "Supported account types", choose "Accounts in any organizational directory (Any Azure AD directory - Multitenant) and personal Microsoft accounts (e.g. Skype, Xbox)".
    *   For "Redirect URI", select "Web" and add `http://localhost:3001/api/auth/microsoft/callback` (replace `3001` with your backend port if different).
3.  **Client Secret**: Go to "Certificates & secrets" > "Client secrets". Create a "New client secret" and copy its value immediately as it will not be shown again.
4.  **Application (Client) ID**: Go to "Overview" and copy the "Application (client) ID".

    ```dotenv
    MICROSOFT_CLIENT_ID="YOUR_MICROSOFT_CLIENT_ID"
    MICROSOFT_CLIENT_SECRET="YOUR_MICROSOFT_CLIENT_SECRET"
    ```

### Email Service (Resend)

ClearTask uses [Resend](https://resend.com/) for sending emails.

1.  **Create a Resend Account**: Sign up at [resend.com](https://resend.com/).
2.  **API Keys**: Generate an API key from your Resend dashboard.

    ```dotenv
    RESEND_API_KEY="re_YOUR_RESEND_API_KEY"
    ```

### Large Language Model (LLM) Configuration

ClearTask uses LLMs for processing natural language commands. A fallback mechanism is implemented (Requesty.ai -> OpenAI -> text-based fallback).

#### Requesty.ai (Primary)

*   `REQUESTY_API_KEY`: Your API key for Requesty.ai.

#### OpenAI (Fallback)

*   `OPENAI_API_KEY`: Your OpenAI API key.
*   `OPENAI_MODEL`: The OpenAI model to use (e.g., `gpt-4o-mini`). **Note: `gpt-3.5-turbo` is deprecated and should not be used.**

    ```dotenv
    REQUESTY_API_KEY="YOUR_REQUESTY_AI_API_KEY"
    OPENAI_API_KEY="YOUR_OPENAI_API_KEY"
    OPENAI_MODEL="gpt-4o-mini" # Preferred model
    ```

### JWT Secret

A secret for signing JWTs for secure communication.

*   `JWT_SECRET`: A strong, random string.

    ```dotenv
    JWT_SECRET="YOUR_VERY_STRONG_AND_RANDOM_JWT_SECRET"
    ```

## Production Deployment

This section covers deploying ClearTask to a production environment using Docker Compose.

### Prerequisites for Production

*   **Linux Server**: A Linux server (Ubuntu, Debian, CentOS, etc.) with Docker and Docker Compose installed.
*   **Domain Name**: A registered domain name pointing to your server's IP address.
*   **SSL Certificate**: An SSL certificate for HTTPS (recommended: use Let's Encrypt with Certbot or a reverse proxy like Nginx/Traefik).
*   **Environment Variables**: All required environment variables configured in a production `.env` file.

### Production Configuration

1.  **Create Production Environment File**:
    Create a `.env` file in the root directory with production values. Key differences from development:
    
    ```dotenv
    NODE_ENV=production
    
    # Production URLs (replace with your actual domain)
    PROD_API_URL=https://api.yourdomain.com
    PROD_FRONTEND_URL=https://yourdomain.com
    
    # Database (use strong passwords)
    POSTGRES_USER=cleartask_prod_user
    POSTGRES_PASSWORD=your_very_strong_database_password
    POSTGRES_DB=cleartaskdb
    
    # OAuth Redirect URIs (update in Google/Microsoft consoles)
    # Google: https://yourdomain.com/api/auth/google/callback
    # Microsoft: https://yourdomain.com/api/auth/microsoft/callback
    
    # Email domain for production (required for Resend)
    RESEND_DOMAIN=yourdomain.com
    
    # All other variables from .env.example
    ```

2.  **Update OAuth Redirect URIs**:
    *   **Google Cloud Console**: Update "Authorized redirect URIs" to `https://yourdomain.com/api/auth/google/callback`
    *   **Azure Portal**: Update "Redirect URI" to `https://yourdomain.com/api/auth/microsoft/callback`
    *   **Gmail Push Notifications**: Update Pub/Sub push subscription endpoint to `https://yourdomain.com/email-ingestion/webhook`

3.  **Deploy with Docker Compose**:
    ```bash
    # Pull latest code
    git pull origin main
    
    # Build and start production services
    docker-compose -f docker-compose.prod.yml up -d --build
    
    # View logs
    docker-compose -f docker-compose.prod.yml logs -f
    
    # Stop services
    docker-compose -f docker-compose.prod.yml down
    ```

### Production Architecture

The [`docker-compose.prod.yml`](docker-compose.prod.yml) file configures:

*   **Frontend**: Nginx serving static files on port 80 (use a reverse proxy for HTTPS)
*   **Backend**: Node.js API on port 3000
*   **Database**: PostgreSQL with persistent volume storage (`db_prod_data`)
*   **Networking**: Internal Docker network (`cleartask-network`) for service communication
*   **Health Checks**: PostgreSQL health checks ensure database is ready before backend starts

### Reverse Proxy Setup (Nginx Example)

For HTTPS support, configure a reverse proxy on your host machine:

```nginx
# /etc/nginx/sites-available/cleartask
server {
    listen 80;
    server_name yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com;
    
    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
    
    # Frontend
    location / {
        proxy_pass http://localhost:80;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# API subdomain
server {
    listen 443 ssl http2;
    server_name api.yourdomain.com;
    
    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
    
    # Backend API
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable the site and reload Nginx:
```bash
sudo ln -s /etc/nginx/sites-available/cleartask /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### SSL Certificate with Let's Encrypt

```bash
# Install Certbot
sudo apt update
sudo apt install certbot python3-certbot-nginx

# Obtain certificate
sudo certbot --nginx -d yourdomain.com -d api.yourdomain.com

# Auto-renewal is configured by default
sudo certbot renew --dry-run
```

### Production Monitoring

*   **View Logs**: `docker-compose -f docker-compose.prod.yml logs -f [service_name]`
*   **Database Backups**:
    ```bash
    docker exec cleartask-db-1 pg_dump -U cleartask_prod_user cleartaskdb > backup_$(date +%Y%m%d).sql
    ```
*   **Resource Monitoring**: Use tools like `htop`, `docker stats`, or monitoring solutions like Prometheus/Grafana

### Security Considerations

*   **Firewall**: Configure firewall to only allow ports 80, 443, and SSH
*   **Database**: PostgreSQL port (5432) is not exposed externally in production config
*   **Environment Variables**: Never commit `.env` file to version control
*   **Regular Updates**: Keep Docker images and system packages updated
*   **Backup Strategy**: Implement regular database backups and test restoration procedures

### Troubleshooting Production Issues

*   **Service won't start**: Check logs with `docker-compose -f docker-compose.prod.yml logs [service_name]`
*   **Database connection errors**: Verify `DB_HOST=db` and database credentials in `.env`
*   **OAuth errors**: Ensure redirect URIs match exactly in OAuth provider consoles
*   **Gmail push notifications not working**: Verify webhook endpoint is publicly accessible and using HTTPS

---

This README provides a comprehensive guide to setting up and running ClearTask in both development and production environments. If you encounter any issues, please refer to the project's documentation or open an issue on the GitHub repository.

import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

/**
 * Creates an authenticated Gmail client using service account or OAuth2 credentials
 * @param {Object} log - Fastify logger instance
 * @returns {Promise<Object>} Authenticated Gmail API client
 */
async function getGmailClient(log) {
  try {
    // Use OAuth2 credentials for Gmail API access
    const oauth2Client = new OAuth2Client(
      process.env.GMAIL_CLIENT_ID,
      process.env.GMAIL_CLIENT_SECRET,
      process.env.GMAIL_REDIRECT_URI
    );

    // Set credentials - in production, these should be stored securely
    // For now, we'll use refresh token to get access token
    if (process.env.GMAIL_REFRESH_TOKEN) {
      oauth2Client.setCredentials({
        refresh_token: process.env.GMAIL_REFRESH_TOKEN
      });
    } else {
      throw new Error('GMAIL_REFRESH_TOKEN not configured');
    }

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    return gmail;
  } catch (error) {
    log.error('Failed to create Gmail client:', error);
    throw error;
  }
}

/**
 * Retrieves the stored historyId for the given email address
 * @param {Object} pool - PostgreSQL connection pool
 * @param {string} emailAddress - Email address to retrieve historyId for
 * @param {Object} log - Fastify logger instance
 * @returns {Promise<string|null>} The stored historyId or null if not found
 */
export async function getStoredHistoryId(pool, emailAddress, log) {
  try {
    const result = await pool.query(
      'SELECT history_id FROM gmail_sync_state WHERE email_address = $1',
      [emailAddress]
    );
    
    if (result.rows.length > 0) {
      log.info(`Retrieved stored historyId for ${emailAddress}: ${result.rows[0].history_id}`);
      return result.rows[0].history_id;
    }
    
    log.info(`No stored historyId found for ${emailAddress}`);
    return null;
  } catch (error) {
    log.error('Failed to retrieve stored historyId:', error);
    throw error;
  }
}

/**
 * Updates the stored historyId for the given email address
 * @param {Object} pool - PostgreSQL connection pool
 * @param {string} emailAddress - Email address to update historyId for
 * @param {string} historyId - New historyId to store
 * @param {Date} watchExpiration - Optional watch expiration timestamp
 * @param {Object} log - Fastify logger instance
 * @returns {Promise<void>}
 */
export async function updateStoredHistoryId(pool, emailAddress, historyId, watchExpiration, log) {
  try {
    await pool.query(
      `INSERT INTO gmail_sync_state (email_address, history_id, watch_expiration, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (email_address)
       DO UPDATE SET 
         history_id = EXCLUDED.history_id,
         watch_expiration = EXCLUDED.watch_expiration,
         updated_at = NOW()`,
      [emailAddress, historyId, watchExpiration]
    );
    
    log.info(`Updated historyId for ${emailAddress}: ${historyId}`);
  } catch (error) {
    log.error('Failed to update stored historyId:', error);
    throw error;
  }
}

/**
 * Initializes Gmail watch for push notifications
 * @param {Object} pool - PostgreSQL connection pool
 * @param {Object} log - Fastify logger instance
 * @returns {Promise<string>} The historyId from the watch response
 */
export async function initializeGmailWatch(pool, log) {
  try {
    const emailAddress = process.env.GMAIL_APP_EMAIL;
    const topicName = process.env.GCP_PUBSUB_TOPIC_NAME;

    if (!emailAddress) {
      throw new Error('GMAIL_APP_EMAIL not configured');
    }

    if (!topicName) {
      throw new Error('GCP_PUBSUB_TOPIC_NAME not configured');
    }

    log.info(`Initializing Gmail watch for ${emailAddress} with topic ${topicName}`);

    const gmail = await getGmailClient(log);

    // Call Gmail API watch endpoint
    const response = await gmail.users.watch({
      userId: emailAddress,
      requestBody: {
        topicName: topicName,
        labelIds: ['INBOX'], // Only watch INBOX
        labelFilterBehavior: 'INCLUDE'
      }
    });

    const { historyId, expiration } = response.data;
    
    log.info(`Gmail watch initialized successfully. HistoryId: ${historyId}, Expiration: ${expiration}`);

    // Convert expiration (milliseconds since epoch) to Date
    const expirationDate = expiration ? new Date(parseInt(expiration)) : null;

    // Store the historyId and expiration in database
    await updateStoredHistoryId(pool, emailAddress, historyId, expirationDate, log);

    return historyId;
  } catch (error) {
    log.error('Failed to initialize Gmail watch:', error);
    
    // Provide more context for common errors
    if (error.code === 400) {
      log.error('Bad request - check that GCP_PUBSUB_TOPIC_NAME is correctly formatted and the topic exists');
    } else if (error.code === 403) {
      log.error('Permission denied - ensure the Gmail API is enabled and the service account has necessary permissions');
    } else if (error.code === 401) {
      log.error('Authentication failed - check GMAIL_REFRESH_TOKEN and OAuth2 credentials');
    }
    
    throw error;
  }
}

/**
 * Renews Gmail watch registration (should be called before expiration)
 * @param {Object} pool - PostgreSQL connection pool
 * @param {Object} log - Fastify logger instance
 * @returns {Promise<string>} The new historyId from the watch response
 */
export async function renewGmailWatch(pool, log) {
  try {
    log.info('Renewing Gmail watch registration');
    
    // Renewing is the same as initializing - Gmail will update the existing watch
    const historyId = await initializeGmailWatch(pool, log);
    
    log.info(`Gmail watch renewed successfully with historyId: ${historyId}`);
    
    return historyId;
  } catch (error) {
    log.error('Failed to renew Gmail watch:', error);
    throw error;
  }
}

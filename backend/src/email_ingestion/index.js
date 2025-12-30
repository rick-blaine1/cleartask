import fp from 'fastify-plugin';
import { z } from 'zod';
import { emailIngestionSchema } from '../schemas/email.schema.js';
import { google } from 'googleapis';
import { isSenderVerified } from './emailVerification.js';
import { isMessageIdLocked, addMessageIdToLockTable } from './messageIdService.js';
import cron from 'node-cron';

export async function fetchEmailContent(emailAddress, messageId) {
  // Existing implementation of fetchEmailContent
  try {
    const oAuth2Client = new google.auth.OAuth2(
      process.env.GMAIL_CLIENT_ID,
      process.env.GMAIL_CLIENT_SECRET
    );
    oAuth2Client.setCredentials({
      refresh_token: process.env.GMAIL_REFRESH_TOKEN,
    });

    const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });

    const fullMessage = await gmail.users.messages.get({
      userId: emailAddress,
      id: messageId,
      format: 'full',
    });

    const headers = fullMessage.data.payload.headers;
    let subject = '';
    let sender = '';
    let messageIdHeader = '';

    for (const header of headers) {
      if (header.name === 'Subject') {
        subject = header.value;
      } else if (header.name === 'From') {
        sender = header.value;
      } else if (header.name === 'Message-ID') {
        messageIdHeader = header.value;
      }
    }

    let body = '';
    const parts = fullMessage.data.payload.parts;
    if (parts) {
      for (const part of parts) {
        if (part.mimeType === 'text/plain' && part.body && part.body.data) {
          body = Buffer.from(part.body.data, 'base64').toString('utf8');
          break;
        } else if (part.mimeType === 'text/html' && part.body && part.body.data) {
          if (!body) {
            body = Buffer.from(part.body.data, 'base64').toString('utf8');
          }
        }
      }
    } else if (fullMessage.data.payload.body && fullMessage.data.payload.body.data) {
      body = Buffer.from(fullMessage.data.payload.body.data, 'base64').toString('utf8');
    }

    const truncatedRequest = truncateOriginalRequest(subject, body);

    return {
      subject: subject,
      body: body,
      messageId: messageIdHeader,
      sender: sender,
      original_request: truncatedRequest,
    };

  } catch (error) {
    console.error(`Error fetching email content for message ID ${messageId}:`, error);
    throw new Error('Could not fetch email content.');
  }
}

export function truncateOriginalRequest(subject, body) {
  const MAX_LENGTH = 30000;
  let result = '';

  const subjectText = subject ? `Subject: ${subject}` : '';
  const bodyText = body || '';

  // Prioritize subject
  if (subjectText.length >= MAX_LENGTH) {
    return subjectText.substring(0, MAX_LENGTH - 3) + '...';
  } else {
    result += subjectText;
  }

  // Add body if there's space
  const remainingLength = MAX_LENGTH - result.length;
  if (remainingLength > 0 && bodyText.length > 0) {
    if (result.length > 0) {
      result += '\n\n'; // Add separator if both exist
    }
    const bodyToAppend = bodyText.substring(0, remainingLength - 3);
    result += bodyToAppend;
    if (bodyText.length > bodyToAppend.length) {
      result += '...';
    }
  }
  return result;
}

async function emailIngestionRoutes(fastify, options) {
  const { pool } = options;
  fastify.get('/email-ingestion/test-auth', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    reply.send({ message: 'Authentication successful for email ingestion endpoint', user: request.user });
  });

  // Dummy endpoint for managing authorized senders with authorization check
  fastify.get('/email-ingestion/authorized-senders/:id', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const authenticatedUserId = request.user.id; // Assuming user ID is available in request.user.id from JWT

    // Simulate fetching authorized sender configuration from a database
    // In a real application, this would involve a database query
    const dummyAuthorizedSender = {
      id: id,
      user_id: 'user123', // This should be a user ID from your system
      email_address: 'sender@example.com',
      // ... other sender configuration details
    };

    // Implement authorization check
    if (dummyAuthorizedSender.user_id !== authenticatedUserId) {
      return reply.status(403).send({ message: 'Forbidden: You do not have access to this authorized sender configuration.' });
    }

    reply.send({ message: `Authorized sender ${id} retrieved successfully.`, data: dummyAuthorizedSender });
  });

  fastify.post('/email-ingestion/webhook', async (request, reply) => {
    try {
      const { message } = request.body;
      if (!message || !message.data) {
        return reply.status(400).send({ message: 'Invalid webhook notification: missing message data.' });
      }

      const decodedData = Buffer.from(message.data, 'base64').toString('utf8');
      const { emailAddress, historyId } = JSON.parse(decodedData);

      if (!emailAddress || !historyId) {
        return reply.status(400).send({ message: 'Invalid decoded message data: missing emailAddress or historyId.' });
      }

      // In a real scenario, you would retrieve the user's Gmail API credentials
      // (e.g., access token, refresh token) based on `emailAddress` from your database.
      // For this implementation, we'll use placeholder credentials.
      const oAuth2Client = new google.auth.OAuth2(
        process.env.GMAIL_CLIENT_ID,
        process.env.GMAIL_CLIENT_SECRET
      );
      // Assuming you have a way to store and retrieve the user's tokens
      oAuth2Client.setCredentials({
        refresh_token: process.env.GMAIL_REFRESH_TOKEN, // Placeholder
      });

      const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });

      // Fetch the history to find new messages
      const historyResponse = await gmail.users.history.list({
        userId: emailAddress,
        startHistoryId: historyId,
        historyTypes: ['messageAdded'],
      });

      const messagesAdded = historyResponse.data.history
        ?.flatMap(hist => hist.messagesAdded || [])
        .map(msgAdded => msgAdded.message);

      if (messagesAdded && messagesAdded.length > 0) {
        for (const msg of messagesAdded) {
          // Fetch the full message using its ID
          const fullMessage = await gmail.users.messages.get({
            userId: emailAddress,
            id: msg.id,
            format: 'full', // 'full' to get the entire message content
          });
          console.log(`Fetched message: ${fullMessage.data.id}`);
          // In a real application, you would process this message (e.g., parse content, ingest)
        }
      } else {
        console.log('No new messages added since last history ID.');
      }

      reply.status(200).send({ message: 'Webhook notification processed successfully.' });
    } catch (error) {
      console.error('Error processing webhook notification:', error);
      reply.status(500).send({ message: 'Internal server error processing webhook notification.' });
    }
  });

  // Function to fetch emails for a given user
  async function fetchEmailsForUser(userId, emailAddress) {
    try {
      // In a real scenario, you would retrieve the user's Gmail API credentials
      // (e.g., access token, refresh token) based on `userId` from your database.
      // For this implementation, we'll use placeholder credentials.
      const oAuth2Client = new google.auth.OAuth2(
        process.env.GMAIL_CLIENT_ID,
        process.env.GMAIL_CLIENT_SECRET
      );
      oAuth2Client.setCredentials({
        refresh_token: process.env.GMAIL_REFRESH_TOKEN, // Placeholder
      });

      const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });

      // Get the current historyId for the user to use as startHistoryId for the next sync
      // This part would ideally be stored per user in a database
      // For this example, we'll fetch the latest history ID
      const response = await gmail.users.getProfile({ userId: 'me' });
      const currentHistoryId = response.data.historyId;

      // Fetch messages since the last known historyId (this would come from user's stored data)
      // For demonstration, let's assume we fetch from a very recent history ID or all unread
      // A more robust solution would store and retrieve the last synced historyId for each user
      const listResponse = await gmail.users.messages.list({
        userId: emailAddress,
        q: 'is:unread', // Example: fetching unread messages
      });

      const messages = listResponse.data.messages;

      if (messages && messages.length > 0) {
        for (const message of messages) {
          const fullMessage = await gmail.users.messages.get({
            userId: emailAddress,
            id: message.id,
            format: 'full',
          });
          console.log(`Synced fetched message for ${emailAddress}: ${fullMessage.data.id}`);
          // Process the message (parse content, ingest, etc.)
          // Mark as read after processing if desired:
          // await gmail.users.messages.modify({
          //   userId: emailAddress,
          //   id: message.id,
          //   resource: {
          //     removeLabelIds: ['UNREAD'],
          //   },
          // });
        }
      } else {
        console.log(`No new unread messages for ${emailAddress} during sync.`);
      }

      // In a real application, update the user's last synced historyId in your database
      console.log(`Sync completed for ${emailAddress}. Current historyId: ${currentHistoryId}`);

    } catch (error) {
      console.error(`Error during email sync for ${emailAddress}:`, error);
    }
  }

  async function fetchEmailContent(emailAddress, messageId) {
    try {
      const oAuth2Client = new google.auth.OAuth2(
        process.env.GMAIL_CLIENT_ID,
        process.env.GMAIL_CLIENT_SECRET
      );
      oAuth2Client.setCredentials({
        refresh_token: process.env.GMAIL_REFRESH_TOKEN,
      });

      const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });

      const fullMessage = await gmail.users.messages.get({
        userId: emailAddress,
        id: messageId,
        format: 'full',
      });

      const headers = fullMessage.data.payload.headers;
      let subject = '';
      let sender = '';
      let messageIdHeader = '';

      for (const header of headers) {
        if (header.name === 'Subject') {
          subject = header.value;
        } else if (header.name === 'From') {
          sender = header.value;
        } else if (header.name === 'Message-ID') {
          messageIdHeader = header.value;
        }
      }

      let body = '';
      const parts = fullMessage.data.payload.parts;
      if (parts) {
        for (const part of parts) {
          if (part.mimeType === 'text/plain' && part.body && part.body.data) {
            body = Buffer.from(part.body.data, 'base64').toString('utf8');
            break;
          } else if (part.mimeType === 'text/html' && part.body && part.body.data) {
            // Optionally, you might want to process HTML or prioritize plain text
            if (!body) { // Only set HTML body if plain text wasn't found
              body = Buffer.from(part.body.data, 'base64').toString('utf8');
            }
          }
        }
      } else if (fullMessage.data.payload.body && fullMessage.data.payload.body.data) {
        body = Buffer.from(fullMessage.data.payload.body.data, 'base64').toString('utf8');
      }

      const truncatedRequest = truncateOriginalRequest(subject, body);

      return {
        subject: subject,
        body: body,
        messageId: messageIdHeader,
        sender: sender,
        original_request: truncatedRequest,
      };

    } catch (error) {
      console.error(`Error fetching email content for message ID ${messageId}:`, error);
      throw new Error('Could not fetch email content.');
    }
  }

  function truncateOriginalRequest(subject, body) {
    const MAX_LENGTH = 30000;
    let result = '';

    const subjectText = subject ? `Subject: ${subject}` : '';
    const bodyText = body || '';

    // Prioritize subject
    if (subjectText.length >= MAX_LENGTH) {
      return subjectText.substring(0, MAX_LENGTH - 3) + '...';
    } else {
      result += subjectText;
    }

    // Add body if there's space
    const remainingLength = MAX_LENGTH - result.length;
    if (remainingLength > 0 && bodyText.length > 0) {
      if (result.length > 0) {
        result += '\n\n'; // Add separator if both exist
      }
      const bodyToAppend = bodyText.substring(0, remainingLength - 3);
      result += bodyToAppend;
      if (bodyText.length > bodyToAppend.length) {
        result += '...';
      }
    }
    return result;
  }

  // Add a new route to expose the fetchEmailContent service
  fastify.get('/email-ingestion/message/:messageId', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { messageId } = request.params;
      const emailAddress = request.user.email; // Assuming user's email is available in request.user.email

      if (!emailAddress) {
        return reply.status(400).send({ message: 'User email not found in authentication token.' });
      }

      const emailContent = await fetchEmailContent(emailAddress, messageId);
      reply.send(emailContent);
    } catch (error) {
      console.error('Error in /email-ingestion/message/:messageId route:', error);
      reply.status(500).send({ message: error.message || 'Failed to retrieve email content.' });
    }
  });

  fastify.post('/api/email-ingestion', async (request, reply) => {
    try {
      const validatedEmail = emailIngestionSchema.parse(request.body);
      fastify.log.info('Received valid email for ingestion:', validatedEmail);

      const senderEmail = validatedEmail.sender.toLowerCase();
      const isVerified = await isSenderVerified(senderEmail, pool);

      if (!isVerified) {
        fastify.log.warn(`Unauthorized sender: ${senderEmail}. Email ingestion rejected.`);
        return reply.status(403).send({ message: 'Sender email address is not authorized.' });
      }

      fastify.log.info(`Sender ${senderEmail} is verified. Proceeding with email ingestion.`);

      // Check for Message-ID deduplication
      if (validatedEmail.messageId) {
        const locked = await isMessageIdLocked(pool, validatedEmail.messageId);
        if (locked) {
          fastify.log.warn(`Duplicate Message-ID received: ${validatedEmail.messageId}. Email ingestion rejected.`);
          return reply.status(409).send({ message: 'Email with this Message-ID has been processed recently.' });
        }
        await addMessageIdToLockTable(pool, validatedEmail.messageId);
      }
      reply.status(200).send({ message: 'Email ingestion endpoint hit and validated successfully.', data: validatedEmail });
    } catch (error) {
      if (error instanceof z.ZodError) {
        fastify.log.warn('Email ingestion validation failed:', error.errors);
        return reply.status(400).send({ message: 'Validation failed', errors: error.errors });
      } else {
        fastify.log.error('Error during email ingestion:', error);
        return reply.status(500).send({ message: 'Internal server error during email ingestion.' });
      }
    }
  });

  // Schedule the sync fallback to run every 30 minutes
  // In a real application, you would iterate through all users who have enabled email ingestion
  // and call fetchEmailsForUser for each of them.
  // Only start cron job in non-test environments
  if (process.env.NODE_ENV !== 'test') {
    cron.schedule('*/30 * * * *', async () => {
      console.log('Running scheduled email sync fallback...');
      // Placeholder: In a real app, retrieve all users who have authorized Gmail access
      // and iterate through them to call fetchEmailsForUser.
      // For this example, we'll assume a single user with a known email address.
      const dummyUserId = 'user123'; // Replace with actual user ID
      const dummyEmailAddress = 'test@gmail.com'; // Replace with actual email address
      console.log(`Attempting to sync emails for user ${dummyUserId} (${dummyEmailAddress})...`);
      await fetchEmailsForUser(dummyUserId, dummyEmailAddress);
    });
  }
}

export default fp(emailIngestionRoutes);

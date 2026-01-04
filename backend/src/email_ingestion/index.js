import fp from 'fastify-plugin';
import { z } from 'zod';
import { emailIngestionSchema } from '../schemas/email.schema.js';
import { google } from 'googleapis';
import { isSenderVerified, getVerifiedUserIdsForSender } from './emailVerification.js';
import { isMessageIdLocked, addMessageIdToLockTable } from './messageIdService.js';
import { getStoredHistoryId, updateStoredHistoryId } from './gmailWatchService.js';
import { createSafeFallbackEmailParsingOutput } from '../schemas/task.schema.js';
import { convert } from 'html-to-text';

export async function fetchEmailContent(emailAddress, messageId) {
  // Fetch email content using app-owned Gmail credentials
  try {
    const oAuth2Client = new google.auth.OAuth2(
      process.env.GMAIL_CLIENT_ID,
      process.env.GMAIL_CLIENT_SECRET
    );
    oAuth2Client.setCredentials({
      refresh_token: process.env.GMAIL_REFRESH_TOKEN,
    });

    const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });

    // Use app's email address for fetching messages
    const appEmail = process.env.GMAIL_APP_EMAIL || emailAddress;
    const fullMessage = await gmail.users.messages.get({
      userId: appEmail,
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
  
  // Convert HTML to plain text (removes all tags/scripts)
  const cleanSubject = subject ? convert(subject, { wordwrap: false }) : '';
  const cleanBody = body ? convert(body, { wordwrap: false }) : '';
  
  let result = '';
  const subjectText = cleanSubject ? `Subject: ${cleanSubject}` : '';
  const bodyText = cleanBody || '';

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

import { buildEmailParsingPrompt, LLM_CONFIGS } from '../../promptTemplates.js';
import OpenAI from "openai";

async function emailIngestionRoutes(fastify, options) {
  const { pool, openai, requesty, llmLogger } = options;
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

  // Health check endpoint for webhook
  fastify.get('/email-ingestion/webhook/health', async (request, reply) => {
    fastify.log.info('Webhook health check endpoint hit');
    reply.send({
      status: 'ok',
      message: 'Webhook endpoint is accessible',
      timestamp: new Date().toISOString(),
      appEmail: process.env.GMAIL_APP_EMAIL,
      pubsubTopic: process.env.GCP_PUBSUB_TOPIC_NAME
    });
  });

  // Gmail push notification webhook for app's monitored email account
  fastify.post('/email-ingestion/webhook', async (request, reply) => {
    fastify.log.info('=== GMAIL WEBHOOK ENDPOINT HIT ===');
    fastify.log.info(`Timestamp: ${new Date().toISOString()}`);
    fastify.log.info(`Request body: ${JSON.stringify(request.body)}`);
    fastify.log.info(`Request headers: ${JSON.stringify(request.headers)}`);
    
    try {
      const { message } = request.body;
      if (!message || !message.data) {
        fastify.log.warn('Invalid webhook notification: missing message data');
        return reply.status(400).send({ message: 'Invalid webhook notification: missing message data.' });
      }

      const decodedData = Buffer.from(message.data, 'base64').toString('utf8');
      fastify.log.debug(`Decoded Pub/Sub message data: ${decodedData}`);
      
      const parsedData = JSON.parse(decodedData);
      // Google's Gmail API uses email_address and history_id (with underscores)
      const emailAddress = parsedData.emailAddress || parsedData.email_address;
      const historyId = parsedData.historyId || parsedData.history_id;

      if (!emailAddress || !historyId) {
        fastify.log.warn(`Invalid decoded message data: missing emailAddress or historyId. Received: ${JSON.stringify(parsedData)}`);
        return reply.status(400).send({ message: 'Invalid decoded message data: missing emailAddress or historyId.' });
      }

      // Verify this notification is for the app's monitored email account
      const appEmail = process.env.GMAIL_APP_EMAIL;
      if (!appEmail) {
        fastify.log.error('GMAIL_APP_EMAIL not configured');
        return reply.status(500).send({ message: 'Server configuration error: monitored email not configured.' });
      }

      if (emailAddress !== appEmail) {
        fastify.log.warn(`Webhook notification for unexpected email address: ${emailAddress}, expected: ${appEmail}`);
        return reply.status(400).send({ message: 'Webhook notification for unexpected email address.' });
      }

      // Use app-owned Gmail credentials
      const oAuth2Client = new google.auth.OAuth2(
        process.env.GMAIL_CLIENT_ID,
        process.env.GMAIL_CLIENT_SECRET
      );
      oAuth2Client.setCredentials({
        refresh_token: process.env.GMAIL_REFRESH_TOKEN,
      });

      const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });

      // Retrieve stored historyId from database as fallback
      let startHistoryId = historyId;
      try {
        const storedHistoryId = await getStoredHistoryId(pool, appEmail, fastify.log);
        if (storedHistoryId) {
          startHistoryId = storedHistoryId;
          fastify.log.info(`Using stored historyId: ${storedHistoryId}`);
        } else if (!historyId) {
          fastify.log.warn('No historyId in notification and no stored historyId found');
          return reply.status(200).send({ message: 'No historyId available, skipping processing.' });
        }
      } catch (dbError) {
        fastify.log.error('Error retrieving stored historyId:', dbError);
        // Continue with historyId from notification if database retrieval fails
      }

      // Fetch the history to find new messages since last historyId
      const historyResponse = await gmail.users.history.list({
        userId: appEmail,
        startHistoryId: startHistoryId,
        historyTypes: ['messageAdded'],
      });

      const messagesAdded = historyResponse.data.history
        ?.flatMap(hist => hist.messagesAdded || [])
        .map(msgAdded => msgAdded.message);

      if (messagesAdded && messagesAdded.length > 0) {
        fastify.log.info(`Processing ${messagesAdded.length} new message(s) from Gmail push notification`);
        
        for (const msg of messagesAdded) {
          try {
            // Fetch the full message content
            const emailContent = await fetchEmailContent(appEmail, msg.id);
            
            // Verify sender is authorized
            let rawSender = emailContent.sender || '';
            let senderEmail = rawSender.toLowerCase();
            // Extract email from format "Name <email@domain.com>"
            const match = senderEmail.match(/<(.*?)>/);
            if (match && match[1]) {
              senderEmail = match[1];
            }
            
            const isVerified = await isSenderVerified(senderEmail, pool);
            
            if (!isVerified) {
              fastify.log.warn(`Skipping message ${msg.id} from unauthorized sender: ${senderEmail}`);
              continue;
            }

            // Check for Message-ID deduplication
            if (emailContent.messageId) {
              const locked = await isMessageIdLocked(pool, emailContent.messageId);
              if (locked) {
                fastify.log.warn(`Skipping duplicate message ${msg.id} with Message-ID: ${emailContent.messageId}`);
                continue;
              }
              await addMessageIdToLockTable(pool, emailContent.messageId);
            }

            fastify.log.info(`Processing message ${msg.id} from verified sender: ${senderEmail}`);
            
            // Process the email content with LLM and create tasks
            try {
              // Get all user IDs for this verified sender
              const userIds = await getVerifiedUserIdsForSender(senderEmail, pool);
              
              if (userIds.length === 0) {
                fastify.log.warn(`No user IDs found for verified sender: ${senderEmail}`);
                continue;
              }
              
              // Parse email with LLM
              let parsedEmailTasks;
              let llmUsed = 'None';
              const requestId = `webhook-email-req_${Date.now()}_${Math.random().toString(36).substring(7)}`;
              const currentDate = new Date().toISOString().split('T')[0];
              const emailContentForLLM = emailContent.body || '';
              const emailSubjectForLLM = emailContent.subject || '';
              
              llmLogger.info({
                requestId,
                event: 'webhook_email_llm_request_start',
                sender: senderEmail,
                messageId: emailContent.messageId,
                subject: emailSubjectForLLM,
                contentLength: emailContentForLLM.length,
                userCount: userIds.length
              }, 'LLM email parsing request initiated from webhook');
              
              const emailParsingPrompt = buildEmailParsingPrompt({
                emailContent: emailContentForLLM,
                emailSubject: emailSubjectForLLM,
                currentDate: currentDate
              });
              
              const callLLM = async (llmClient, modelName, timeoutMs) => {
                const timeoutPromise = new Promise((resolve, reject) => {
                  setTimeout(() => {
                    reject(new Error(`${modelName} API call for email parsing timed out after ${timeoutMs / 1000} seconds`));
                  }, timeoutMs);
                });
                
                const llmCallPromise = llmClient.chat.completions.create({
                  model: modelName,
                  messages: [{
                    role: "user",
                    content: emailParsingPrompt
                  }],
                  response_format: { type: "json_object" },
                });
                
                const response = await Promise.race([llmCallPromise, timeoutPromise]);
                return JSON.parse(response.choices[0].message.content);
              };
              
              // Try Requesty first
              if (requesty) {
                try {
                  llmLogger.debug({
                    requestId,
                    event: 'llm_call_start',
                    provider: LLM_CONFIGS.REQUESTY.name,
                    model: LLM_CONFIGS.REQUESTY.model,
                    timeout: LLM_CONFIGS.REQUESTY.timeout
                  }, 'Attempting LLM call to Requesty for webhook email parsing');
                  
                  parsedEmailTasks = await callLLM(requesty, LLM_CONFIGS.REQUESTY.model, LLM_CONFIGS.REQUESTY.timeout);
                  llmUsed = LLM_CONFIGS.REQUESTY.name;
                  
                  llmLogger.info({
                    requestId,
                    event: 'llm_call_success',
                    provider: LLM_CONFIGS.REQUESTY.name,
                    outputSize: JSON.stringify(parsedEmailTasks).length
                  }, 'Webhook email parsed successfully using Requesty');
                  
                } catch (requestyError) {
                  llmLogger.warn({
                    requestId,
                    event: 'llm_call_failed',
                    provider: LLM_CONFIGS.REQUESTY.name,
                    error: requestyError.message,
                    willFallback: !!openai
                  }, 'Requesty failed for webhook email parsing, falling back to OpenAI');
                  
                  // Fallback to OpenAI if Requesty fails
                  if (openai) {
                    try {
                      llmLogger.debug({
                        requestId,
                        event: 'llm_call_start',
                        provider: LLM_CONFIGS.OPENAI_GPT4O_MINI.name,
                        model: LLM_CONFIGS.OPENAI_GPT4O_MINI.model,
                        timeout: LLM_CONFIGS.OPENAI_GPT4O_MINI.timeout,
                        isFallback: true
                      }, 'Attempting fallback LLM call to OpenAI for webhook email parsing');
                      
                      parsedEmailTasks = await callLLM(openai, LLM_CONFIGS.OPENAI_GPT4O_MINI.model, LLM_CONFIGS.OPENAI_GPT4O_MINI.timeout);
                      llmUsed = LLM_CONFIGS.OPENAI_GPT4O_MINI.name;
                      
                      llmLogger.info({
                        requestId,
                        event: 'llm_call_success',
                        provider: LLM_CONFIGS.OPENAI_GPT4O_MINI.name,
                        outputSize: JSON.stringify(parsedEmailTasks).length,
                        isFallback: true
                      }, 'Webhook email parsed successfully using OpenAI fallback');
                    } catch (openaiError) {
                      llmLogger.error({
                        requestId,
                        event: 'llm_call_failed',
                        provider: LLM_CONFIGS.OPENAI_GPT4O_MINI.name,
                        error: openaiError.message,
                        isFallback: true
                      }, 'OpenAI fallback also failed for webhook email parsing');
                    }
                  }
                }
              } else if (openai) {
                // If Requesty is not configured, try OpenAI directly
                try {
                  llmLogger.debug({
                    requestId,
                    event: 'llm_call_start',
                    provider: LLM_CONFIGS.OPENAI_GPT4O_MINI.name,
                    model: LLM_CONFIGS.OPENAI_GPT4O_MINI.model,
                    timeout: LLM_CONFIGS.OPENAI_GPT4O_MINI.timeout
                  }, 'Attempting LLM call to OpenAI for webhook email parsing');
                  
                  parsedEmailTasks = await callLLM(openai, LLM_CONFIGS.OPENAI_GPT4O_MINI.model, LLM_CONFIGS.OPENAI_GPT4O_MINI.timeout);
                  llmUsed = LLM_CONFIGS.OPENAI_GPT4O_MINI.name;
                  
                  llmLogger.info({
                    requestId,
                    event: 'llm_call_success',
                    provider: LLM_CONFIGS.OPENAI_GPT4O_MINI.name,
                    outputSize: JSON.stringify(parsedEmailTasks).length
                  }, 'Webhook email parsed successfully using OpenAI');
                } catch (openaiError) {
                  llmLogger.error({
                    requestId,
                    event: 'llm_call_failed',
                    provider: LLM_CONFIGS.OPENAI_GPT4O_MINI.name,
                    error: openaiError.message
                  }, 'OpenAI API call failed for webhook email parsing');
                }
              }
              
              if (!parsedEmailTasks) {
                llmLogger.warn({
                  requestId,
                  event: 'fallback_activated',
                  reason: 'no_llm_output_webhook_email_parsing'
                }, 'No LLM output for webhook email parsing, using safe fallback');
                parsedEmailTasks = createSafeFallbackEmailParsingOutput(
                  emailContentForLLM,
                  senderEmail,
                  emailSubjectForLLM
                );
                llmUsed = 'Fallback (No LLM)';
              }
              
              // Validate LLM output
              if (!parsedEmailTasks.tasks || !Array.isArray(parsedEmailTasks.tasks)) {
                llmLogger.warn({
                  requestId,
                  event: 'validation_failed',
                  reason: 'invalid_tasks_structure',
                  securitySignal: 'WEBHOOK_EMAIL_LLM_VALIDATION_FAILURE'
                }, 'LLM webhook email parsing output has invalid structure, using safe fallback');
                parsedEmailTasks = createSafeFallbackEmailParsingOutput(
                  emailContentForLLM,
                  senderEmail,
                  emailSubjectForLLM
                );
                llmUsed = 'Fallback (Validation Failed)';
              }
              
              // Create tasks in database for each user
              let tasksCreated = 0;
              for (const userId of userIds) {
                for (const task of parsedEmailTasks.tasks) {
                  try {
                    const dbClient = await pool.connect();
                    try {
                      await dbClient.query(
                        'INSERT INTO tasks (id, user_id, task_name, due_date, is_completed, original_request) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)',
                        [
                          userId,
                          task.task_name || `Review email: ${emailSubjectForLLM}`,
                          task.due_date || null,
                          task.is_completed || false,
                          emailContent.original_request || emailContentForLLM.substring(0, 2000)
                        ]
                      );
                      tasksCreated++;
                      fastify.log.info(`Created task for user ${userId} from email: ${task.task_name}`);
                    } finally {
                      dbClient.release();
                    }
                  } catch (dbError) {
                    fastify.log.error(`Error creating task for user ${userId}:`, dbError);
                    // Continue with other tasks even if one fails
                  }
                }
              }
              
              llmLogger.info({
                requestId,
                event: 'webhook_email_processing_complete',
                llmUsed,
                taskCount: parsedEmailTasks.tasks.length,
                tasksCreated,
                userCount: userIds.length
              }, `Successfully processed webhook email and created ${tasksCreated} task(s)`);
              
              fastify.log.info(`Successfully processed message ${msg.id}: created ${tasksCreated} task(s) for ${userIds.length} user(s)`);
              
            } catch (processingError) {
              fastify.log.error(`Error processing email content for message ${msg.id}:`, processingError);
              // Continue with other messages even if this one fails
            }
            
          } catch (msgError) {
            fastify.log.error(`Error processing message ${msg.id}:`, msgError);
            // Continue processing other messages even if one fails
          }
        }
        
        // Update stored historyId after successfully processing messages
        try {
          const latestHistoryId = historyResponse.data.historyId;
          if (latestHistoryId) {
            await updateStoredHistoryId(pool, appEmail, latestHistoryId, null, fastify.log);
            fastify.log.info(`Updated stored historyId to: ${latestHistoryId}`);
          }
        } catch (updateError) {
          fastify.log.error('Error updating stored historyId:', updateError);
          // Don't fail the request if historyId update fails
        }
      } else {
        fastify.log.debug('No new messages added since last history ID');
        
        // Still update historyId even if no new messages
        try {
          const latestHistoryId = historyResponse.data.historyId;
          if (latestHistoryId) {
            await updateStoredHistoryId(pool, appEmail, latestHistoryId, null, fastify.log);
          }
        } catch (updateError) {
          fastify.log.error('Error updating stored historyId:', updateError);
        }
      }

      reply.status(200).send({ message: 'Webhook notification processed successfully.' });
    } catch (error) {
      fastify.log.error('Error processing webhook notification:', error);
      reply.status(500).send({ message: 'Internal server error processing webhook notification.' });
    }
  });

  async function fetchEmailContent(emailAddress, messageId) {
    // Fetch email content using app-owned Gmail credentials
    try {
      const oAuth2Client = new google.auth.OAuth2(
        process.env.GMAIL_CLIENT_ID,
        process.env.GMAIL_CLIENT_SECRET
      );
      oAuth2Client.setCredentials({
        refresh_token: process.env.GMAIL_REFRESH_TOKEN,
      });

      const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });

      // Use app's email address for fetching messages
      const appEmail = process.env.GMAIL_APP_EMAIL || emailAddress;
      const fullMessage = await gmail.users.messages.get({
        userId: appEmail,
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
    
    // Convert HTML to plain text (removes all tags/scripts)
    const cleanSubject = subject ? convert(subject, { wordwrap: false }) : '';
    const cleanBody = body ? convert(body, { wordwrap: false }) : '';
    
    let result = '';
    const subjectText = cleanSubject ? `Subject: ${cleanSubject}` : '';
    const bodyText = cleanBody || '';

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

      let rawSender = validatedEmail.sender || '';
      let senderEmail = rawSender.toLowerCase();
      // Extract email from format "Name <email@domain.com>"
      const match = senderEmail.match(/<(.*?)>/);
      if (match && match[1]) {
        senderEmail = match[1];
      }
      
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
      
      // *** LLM Parsing Logic ***
      let parsedEmailTasks;
      let llmUsed = 'None';
      const requestId = `email-ingestion-req_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      const currentDate = new Date().toISOString().split('T')[0];
      const emailContentForLLM = validatedEmail.body || validatedEmail.htmlBody || '';
      const emailSubjectForLLM = validatedEmail.subject || '';

      llmLogger.info({
        requestId,
        event: 'email_llm_request_start',
        sender: senderEmail,
        messageId: validatedEmail.messageId,
        subject: emailSubjectForLLM,
        contentLength: emailContentForLLM.length
      }, 'LLM email parsing request initiated');

      const emailParsingPrompt = buildEmailParsingPrompt({
        emailContent: emailContentForLLM,
        emailSubject: emailSubjectForLLM,
        currentDate: currentDate
      });

      const callLLM = async (llmClient, modelName, timeoutMs) => {
        const timeoutPromise = new Promise((resolve, reject) => {
          setTimeout(() => {
            reject(new Error(`${modelName} API call for email parsing timed out after ${timeoutMs / 1000} seconds`));
          }, timeoutMs);
        });

        const llmCallPromise = llmClient.chat.completions.create({
          model: modelName,
          messages: [{
            role: "user",
            content: emailParsingPrompt
          }],
          response_format: { type: "json_object" },
        });

        const response = await Promise.race([llmCallPromise, timeoutPromise]);
        return JSON.parse(response.choices[0].message.content);
      };

      // Try Requesty first
      if (requesty) {
        try {
          llmLogger.debug({
            requestId,
            event: 'llm_call_start',
            provider: LLM_CONFIGS.REQUESTY.name,
            model: LLM_CONFIGS.REQUESTY.model,
            timeout: LLM_CONFIGS.REQUESTY.timeout
          }, 'Attempting LLM call to Requesty for email parsing');
          
          parsedEmailTasks = await callLLM(requesty, LLM_CONFIGS.REQUESTY.model, LLM_CONFIGS.REQUESTY.timeout);
          llmUsed = LLM_CONFIGS.REQUESTY.name;

          llmLogger.info({
            requestId,
            event: 'llm_call_success',
            provider: LLM_CONFIGS.REQUESTY.name,
            outputSize: JSON.stringify(parsedEmailTasks).length
          }, 'Email parsed successfully using Requesty');

        } catch (requestyError) {
          llmLogger.warn({
            requestId,
            event: 'llm_call_failed',
            provider: LLM_CONFIGS.REQUESTY.name,
            error: requestyError.message,
            willFallback: !!openai
          }, 'Requesty failed or timed out for email parsing, falling back to OpenAI');

          // Fallback to OpenAI if Requesty fails
          if (openai) {
            try {
              llmLogger.debug({
                requestId,
                event: 'llm_call_start',
                provider: LLM_CONFIGS.OPENAI_GPT4O_MINI.name,
                model: LLM_CONFIGS.OPENAI_GPT4O_MINI.model,
                timeout: LLM_CONFIGS.OPENAI_GPT4O_MINI.timeout,
                isFallback: true
              }, 'Attempting fallback LLM call to OpenAI for email parsing');

              parsedEmailTasks = await callLLM(openai, LLM_CONFIGS.OPENAI_GPT4O_MINI.model, LLM_CONFIGS.OPENAI_GPT4O_MINI.timeout);
              llmUsed = LLM_CONFIGS.OPENAI_GPT4O_MINI.name;

              llmLogger.info({
                requestId,
                event: 'llm_call_success',
                provider: LLM_CONFIGS.OPENAI_GPT4O_MINI.name,
                outputSize: JSON.stringify(parsedEmailTasks).length,
                isFallback: true
              }, 'Email parsed successfully using OpenAI fallback');
            } catch (openaiError) {
              llmLogger.error({
                requestId,
                event: 'llm_call_failed',
                provider: LLM_CONFIGS.OPENAI_GPT4O_MINI.name,
                error: openaiError.message,
                isFallback: true
              }, 'OpenAI fallback also failed for email parsing');
            }
          }
        }
      } else if (openai) {
        // If Requesty is not configured, try OpenAI directly
        try {
          llmLogger.debug({
            requestId,
            event: 'llm_call_start',
            provider: LLM_CONFIGS.OPENAI_GPT4O_MINI.name,
            model: LLM_CONFIGS.OPENAI_GPT4O_MINI.model,
            timeout: LLM_CONFIGS.OPENAI_GPT4O_MINI.timeout
          }, 'Attempting LLM call to OpenAI for email parsing');

          parsedEmailTasks = await callLLM(openai, LLM_CONFIGS.OPENAI_GPT4O_MINI.model, LLM_CONFIGS.OPENAI_GPT4O_MINI.timeout);
          llmUsed = LLM_CONFIGS.OPENAI_GPT4O_MINI.name;

          llmLogger.info({
            requestId,
            event: 'llm_call_success',
            provider: LLM_CONFIGS.OPENAI_GPT4O_MINI.name,
            outputSize: JSON.stringify(parsedEmailTasks).length
          }, 'Email parsed successfully using OpenAI');
        } catch (openaiError) {
          llmLogger.error({
            requestId,
            event: 'llm_call_failed',
            provider: LLM_CONFIGS.OPENAI_GPT4O_MINI.name,
            error: openaiError.message
          }, 'OpenAI API call failed for email parsing');
        }
      }

      if (!parsedEmailTasks) {
        llmLogger.warn({
          requestId,
          event: 'fallback_activated',
          reason: 'no_llm_output_email_parsing'
        }, 'No LLM output for email parsing, using safe fallback');
        parsedEmailTasks = createSafeFallbackEmailParsingOutput(emailContentForLLM);
        llmUsed = 'Fallback (No LLM)';
      }

      // Validate LLM output against schema
      const validationResult = emailIngestionSchema.safeParse(parsedEmailTasks);

      if (!validationResult.success) {
        llmLogger.warn({
          requestId,
          event: 'validation_failed',
          error: validationResult.error?.message,
          issues: validationResult.error?.issues,
          securitySignal: 'EMAIL_LLM_VALIDATION_FAILURE'
        }, 'LLM email parsing output failed schema validation, using safe fallback');
        parsedEmailTasks = createSafeFallbackEmailParsingOutput(emailContentForLLM);
        llmUsed = 'Fallback (Validation Failed)';
      } else {
        parsedEmailTasks = validationResult.data;
        llmLogger.info({
          requestId,
          event: 'validation_success',
          llmUsed,
          taskCount: parsedEmailTasks.tasks?.length || 0
        }, 'LLM email parsing output validated successfully');
      }

      // Here you would process the parsedEmailTasks (e.g., save them to the database)
      // For now, we'll just return the parsed tasks
      reply.status(200).send({
        message: 'Email ingestion and parsing complete.',
        parsedTasks: parsedEmailTasks,
        llmUsed: llmUsed
      });
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
}

export default fp(emailIngestionRoutes);

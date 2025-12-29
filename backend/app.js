import Fastify from 'fastify';
import pg from 'pg';
import fastifyJwt from '@fastify/jwt';
import fastifyOAuth2 from '@fastify/oauth2';
import cors from '@fastify/cors';
import OpenAI from "openai";
import { processUserInput } from './inputProcessor.js';
import { buildTaskParsingPrompt, buildTaskSuggestionPrompt, sanitizeUserInput } from './promptTemplates.js';
import { validateLLMTaskOutput, createSafeFallbackTask, sanitizeForDatabase } from './src/schemas/task.schema.js';
import { llmLogger } from './utils/llmLogger.js';

function buildApp() {
  const fastify = Fastify({ logger: true });

  fastify.register(fastifyJwt, {
    secret: process.env.JWT_SECRET || 'supersecretjwtkey'
  });

  fastify.register(fastifyOAuth2, {
    name: 'googleOAuth2',
    scope: ['profile', 'email'],
    credentials: {
      client: {
        id: process.env.GOOGLE_CLIENT_ID || '',
        secret: process.env.GOOGLE_CLIENT_SECRET || '',
      },
      auth: fastifyOAuth2.GOOGLE_CONFIGURATION
    },
    startRedirectPath: '/api/auth/google',
    callbackUri: `${process.env.BASE_URL || 'http://localhost:3000'}/api/auth/google/callback`,
  });

  // Register Microsoft OAuth2 without startRedirectPath to avoid route conflict
  fastify.register(fastifyOAuth2, {
    name: 'microsoftOAuth2', // Unique name for Microsoft OAuth
    scope: ['openid', 'profile', 'email', 'offline_access'], // Define necessary scopes
    credentials: {
      client: {
        id: process.env.MICROSOFT_CLIENT_ID || '',
        secret: process.env.MICROSOFT_CLIENT_SECRET || '',
      },
      auth: {
        authorizeHost: 'https://login.microsoftonline.com',
        authorizePath: '/common/oauth2/v2.0/authorize',
        tokenHost: 'https://login.microsoftonline.com',
        tokenPath: '/common/oauth2/v2.0/token'
      }
    },
    // Don't use startRedirectPath - we'll create a custom route instead
    callbackUri: `${process.env.BASE_URL || 'http://localhost:3000'}/api/auth/microsoft/callback`,
    generateStateFunction: () => {
      return Math.random().toString(36).substring(7);
    },
    checkStateFunction: () => true,
  });

  // Custom route to handle Microsoft OAuth with prompt parameter
  fastify.get('/api/auth/microsoft', async (request, reply) => {
    fastify.log.info('=== Microsoft OAuth Initiation ===');
    fastify.log.info(`Query params received: ${JSON.stringify(request.query)}`);
    
    // Get the authorization URL from the OAuth2 plugin (await the promise)
    const authorizationUrl = await fastify.microsoftOAuth2.generateAuthorizationUri(request, reply);
    
    // Add prompt=select_account to force account selection
    const urlWithPrompt = `${authorizationUrl}&prompt=select_account`;
    
    fastify.log.info(`Original authorization URL: ${authorizationUrl}`);
    fastify.log.info(`Modified authorization URL with prompt: ${urlWithPrompt}`);
    
    reply.redirect(urlWithPrompt);
  });

  fastify.register(cors, {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
  });

  const { Pool } = pg;
  const pool = new Pool({
    user: process.env.DB_USER || 'user',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'cleartaskdb',
    password: process.env.DB_PASSWORD || 'password',
    port: process.env.DB_PORT || 5432,
  });

  // Expose pool for initialization
  fastify.decorate('pool', pool);

  // Initialize OpenAI client only if API key is provided
  const openai = process.env.OPENAI_API_KEY ? new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  }) : null;

  // Initialize Requesty client only if API key is provided
  const requesty = process.env.REQUESTY_API_KEY ? new OpenAI({
    apiKey: process.env.REQUESTY_API_KEY,
    baseURL: "https://router.requesty.ai/v1",
  }) : null;

  fastify.decorate("authenticate", async function (request, reply) {
    try {
      await request.jwtVerify();
      request.user.id = request.user.userId;
    } catch (err) {
      reply.send(err)
    }
  });

  fastify.get('/', async (request, reply) => {
    return { hello: 'world' };
  });

  fastify.get('/api/tasks', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    try {
      const client = await pool.connect();
      const showArchived = request.query.showArchived === 'true';
      const result = await client.query(
        `SELECT * FROM tasks WHERE user_id = $1 ${showArchived ? '' : 'AND is_archived = FALSE'} ORDER BY due_date ASC NULLS FIRST`,
        [request.user.id]
      );
      client.release();
      reply.send(result.rows);
    } catch (err) {
      fastify.log.error(err);
      reply.status(500).send({ error: 'Internal Server Error' });
    }
  });

  fastify.get('/protected', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    return { user: request.user };
  });

  fastify.get('/api/auth/google/callback', async function (request, reply) {
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
      reply.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/#token=${ourJwt}`);
    } catch (error) {
      fastify.log.error('OAuth callback error:', error);
      reply.status(500).send({ error: 'OAuth callback failed' });
    }
  });

  fastify.get('/api/auth/microsoft/callback', async function (request, reply) {
    fastify.log.info('=== Microsoft OAuth Callback Hit ===');
    fastify.log.info(`Query params: ${JSON.stringify(request.query)}`);
    fastify.log.info(`Full URL: ${request.url}`);
    try {
      fastify.log.info('Attempting to get access token from authorization code flow.');
      const { token } = await this.microsoftOAuth2.getAccessTokenFromAuthorizationCodeFlow(request);
      fastify.log.info('Successfully received access token.');
      fastify.log.info(`Access token: ${token.access_token ? '[REDACTED]' : 'N/A'}`);
      fastify.log.info(`Refresh token: ${token.refresh_token ? '[REDACTED]' : 'N/A'}`);

      fastify.log.info('Attempting to fetch user info from Microsoft Graph API.');
      const userInfoResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: {
          Authorization: `Bearer ${token.access_token}`,
        },
      });
      fastify.log.info(`Microsoft Graph API response status: ${userInfoResponse.status}`);
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
      fastify.log.error('Microsoft OAuth callback error:', error.message);
      fastify.log.error('Microsoft OAuth callback stack:', error.stack);
      reply.status(500).send({ error: 'Microsoft OAuth callback failed' });
    }
  });

  fastify.post('/api/tasks/create-from-voice', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    
    try {
      const { transcribedText: rawTranscribedText, clientDate, clientTimezoneOffset } = request.body;
      
      // Log initial request with security context
      llmLogger.info({
        requestId,
        userId: request.user.id,
        event: 'llm_request_start',
        rawInputLength: rawTranscribedText?.length || 0,
        timestamp: new Date().toISOString()
      }, 'LLM task parsing request initiated');
      
      const transcribedText = processUserInput(rawTranscribedText, request.user.id);

      if (!transcribedText) {
        llmLogger.warn({
          requestId,
          userId: request.user.id,
          event: 'input_validation_failed',
          reason: 'empty_transcribed_text'
        }, 'Request rejected: empty transcribed text');
        return reply.status(400).send({ error: 'Transcribed text is required.' });
      }

      let rawLLMOutput = null;
      let llmUsed = 'None';
      const clientCurrentDate = new Date(clientDate);
      clientCurrentDate.setMinutes(clientCurrentDate.getMinutes() - clientTimezoneOffset);
      const currentTimeForLLM = clientCurrentDate.toISOString().split('T')[0];

      // Fetch existing tasks for context
      const client = await pool.connect();
      let existingTasks = [];
      try {
        const tasksResult = await client.query(
          'SELECT id, task_name, due_date, is_completed FROM tasks WHERE user_id = $1 AND is_archived = FALSE ORDER BY due_date ASC NULLS FIRST',
          [request.user.id]
        );
        existingTasks = tasksResult.rows;
        fastify.log.info(`Found ${existingTasks.length} existing tasks for user ${request.user.id}`);
      } catch (err) {
        fastify.log.error('Error fetching existing tasks:', err);
      } finally {
        client.release();
      }

      // Use reusable prompt template with sanitized input
      const sanitizedInput = sanitizeUserInput(transcribedText);
      
      // Log input sanitization
      if (sanitizedInput !== transcribedText) {
        llmLogger.warn({
          requestId,
          userId: request.user.id,
          event: 'input_sanitized',
          originalLength: transcribedText.length,
          sanitizedLength: sanitizedInput.length,
          changeDetected: true
        }, 'User input was sanitized before LLM processing');
      }
      
      const prompt = buildTaskParsingPrompt({
        transcribedText: sanitizedInput,
        currentDate: currentTimeForLLM,
        existingTasks
      });
      
      // Log prompt construction (without full content to avoid log bloat)
      llmLogger.debug({
        requestId,
        userId: request.user.id,
        event: 'prompt_constructed',
        promptLength: prompt.length,
        existingTasksCount: existingTasks.length
      }, 'LLM prompt constructed');
      
      const callLLM = async (llmClient, modelName, timeoutMs) => {
        const timeoutPromise = new Promise((resolve, reject) => {
          setTimeout(() => {
            reject(new Error(`${modelName} API call for task parsing timed out after ${timeoutMs / 1000} seconds`));
          }, timeoutMs);
        });

        const llmCallPromise = llmClient.chat.completions.create({
          model: modelName,
          messages: [{
            role: "user",
            content: prompt
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
            userId: request.user.id,
            event: 'llm_call_start',
            provider: 'Requesty',
            model: 'openai/gpt-4o-mini',
            timeout: 5000
          }, 'Attempting LLM call to Requesty');
          
          rawLLMOutput = await callLLM(requesty, "openai/gpt-4o-mini", 5000);
          llmUsed = 'Requesty';
          
          llmLogger.info({
            requestId,
            userId: request.user.id,
            event: 'llm_call_success',
            provider: 'Requesty',
            outputSize: JSON.stringify(rawLLMOutput).length
          }, 'Task parsed successfully using Requesty');
        } catch (requestyError) {
          llmLogger.warn({
            requestId,
            userId: request.user.id,
            event: 'llm_call_failed',
            provider: 'Requesty',
            error: requestyError.message,
            willFallback: !!openai
          }, 'Requesty failed or timed out, falling back to OpenAI');
          
          // Fallback to OpenAI if Requesty fails
          if (openai) {
            try {
              llmLogger.debug({
                requestId,
                userId: request.user.id,
                event: 'llm_call_start',
                provider: 'OpenAI',
                model: 'gpt-4o-mini',
                timeout: 3000,
                isFallback: true
              }, 'Attempting fallback LLM call to OpenAI');
              
              rawLLMOutput = await callLLM(openai, "gpt-4o-mini", 3000);
              llmUsed = 'OpenAI';
              
              llmLogger.info({
                requestId,
                userId: request.user.id,
                event: 'llm_call_success',
                provider: 'OpenAI',
                outputSize: JSON.stringify(rawLLMOutput).length,
                isFallback: true
              }, 'Task parsed successfully using OpenAI fallback');
            } catch (openaiError) {
              llmLogger.error({
                requestId,
                userId: request.user.id,
                event: 'llm_call_failed',
                provider: 'OpenAI',
                error: openaiError.message,
                isFallback: true
              }, 'OpenAI fallback also failed');
            }
          }
        }
      } else if (openai) {
        // If Requesty is not configured, try OpenAI directly
        try {
          llmLogger.debug({
            requestId,
            userId: request.user.id,
            event: 'llm_call_start',
            provider: 'OpenAI',
            model: 'gpt-4o-mini',
            timeout: 3000
          }, 'Attempting LLM call to OpenAI');
          
          rawLLMOutput = await callLLM(openai, "gpt-4o-mini", 3000);
          llmUsed = 'OpenAI';
          
          llmLogger.info({
            requestId,
            userId: request.user.id,
            event: 'llm_call_success',
            provider: 'OpenAI',
            outputSize: JSON.stringify(rawLLMOutput).length
          }, 'Task parsed successfully using OpenAI');
        } catch (openaiError) {
          llmLogger.error({
            requestId,
            userId: request.user.id,
            event: 'llm_call_failed',
            provider: 'OpenAI',
            error: openaiError.message
          }, 'OpenAI API call failed');
        }
      }

      // CRITICAL SECURITY CONTROL: Validate LLM output before any database operations
      // This is the trust boundary - LLM output is untrusted until validated
      let validatedTaskData;
      let usedFallback = false;
      
      if (rawLLMOutput) {
        llmLogger.info({
          requestId,
          userId: request.user.id,
          event: 'llm_output_received',
          outputStructure: Object.keys(rawLLMOutput),
          outputSize: JSON.stringify(rawLLMOutput).length
        }, 'Raw LLM output received');
        
        // Log full output in debug mode only
        llmLogger.debug({
          requestId,
          userId: request.user.id,
          rawLLMOutput
        }, 'Full LLM output (debug)');
        
        const validationResult = validateLLMTaskOutput(rawLLMOutput);
        
        if (validationResult.success) {
          llmLogger.info({
            requestId,
            userId: request.user.id,
            event: 'validation_success',
            intent: validationResult.data.intent,
            hasTaskId: !!validationResult.data.task_id
          }, 'LLM output passed schema validation');
          
          validatedTaskData = sanitizeForDatabase(validationResult.data);
        } else {
          // Schema validation failed - log and use safe fallback
          llmLogger.warn({
            requestId,
            userId: request.user.id,
            event: 'validation_failed',
            error: validationResult.error?.message,
            issues: validationResult.issues,
            securitySignal: 'VALIDATION_FAILURE'
          }, 'LLM output failed schema validation - potential prompt injection or malformed output');
          
          llmLogger.warn({
            requestId,
            userId: request.user.id,
            event: 'fallback_activated',
            reason: 'validation_failed'
          }, 'Using safe fallback task creation');
          
          validatedTaskData = createSafeFallbackTask(transcribedText);
          usedFallback = true;
          llmUsed = 'Fallback (Validation Failed)';
        }
      } else {
        // No LLM output - use safe fallback
        llmLogger.warn({
          requestId,
          userId: request.user.id,
          event: 'fallback_activated',
          reason: 'no_llm_output',
          securitySignal: 'NO_LLM_OUTPUT'
        }, 'No LLM configured or all LLMs failed, using safe fallback for task parsing');
        
        validatedTaskData = createSafeFallbackTask(transcribedText);
        usedFallback = true;
        llmUsed = 'Fallback (No LLM)';
      }

      llmLogger.info({
        requestId,
        userId: request.user.id,
        event: 'task_data_validated',
        llmUsed,
        intent: validatedTaskData.intent,
        taskId: validatedTaskData.task_id,
        usedFallback
      }, 'Task data validated and ready for processing');

      // SEPARATION OF RESPONSIBILITIES: Application logic decides database operations
      // The LLM only suggests - the application enforces
      const dbClient = await pool.connect();
      try {
        // Business logic validation: edit_task requires valid task_id
        if (validatedTaskData.intent === "edit_task" && validatedTaskData.task_id) {
          // Verify task exists and belongs to user before allowing edit
          const verifyResult = await dbClient.query(
            'SELECT id FROM tasks WHERE id = $1 AND user_id = $2',
            [validatedTaskData.task_id, request.user.id]
          );
          
          if (verifyResult.rowCount === 0) {
            // Task doesn't exist or doesn't belong to user - fail closed to create_task
            llmLogger.warn({
              requestId,
              userId: request.user.id,
              event: 'intent_downgraded',
              originalIntent: 'edit_task',
              newIntent: 'create_task',
              taskId: validatedTaskData.task_id,
              reason: 'task_not_found_or_unauthorized',
              securitySignal: 'INTENT_DOWNGRADE'
            }, 'Task not found or unauthorized - failing closed to create_task');
            
            validatedTaskData.intent = 'create_task';
            validatedTaskData.task_id = null;
          }
        }
        
        // Execute database operation based on validated intent
        if (validatedTaskData.intent === "edit_task" && validatedTaskData.task_id) {
          llmLogger.info({
            requestId,
            userId: request.user.id,
            event: 'database_operation',
            operation: 'update_task',
            taskId: validatedTaskData.task_id
          }, 'Executing task update operation');
          
          const updateQuery = `
            UPDATE tasks
            SET
              task_name = COALESCE($1, task_name),
              due_date = COALESCE($2, due_date),
              is_completed = COALESCE($3, is_completed),
              original_request = $4,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = $5 AND user_id = $6
            RETURNING id, task_name, due_date, is_completed, original_request, is_archived;
          `;
          const updateResult = await dbClient.query(
            updateQuery,
            [
              validatedTaskData.task_name,
              validatedTaskData.due_date,
              validatedTaskData.is_completed,
              validatedTaskData.original_request,
              validatedTaskData.task_id,
              request.user.id
            ]
          );

          if (updateResult.rowCount === 0) {
            llmLogger.error({
              requestId,
              userId: request.user.id,
              event: 'database_operation_failed',
              operation: 'update_task',
              taskId: validatedTaskData.task_id,
              reason: 'task_not_found'
            }, 'Task update failed - task not found');
            
            reply.status(404).send({ error: 'Task not found or user not authorized for update.' });
          } else {
            llmLogger.info({
              requestId,
              userId: request.user.id,
              event: 'database_operation_success',
              operation: 'update_task',
              taskId: updateResult.rows[0].id
            }, 'Task updated successfully');
            
            reply.status(200).send(updateResult.rows[0]);
          }
        } else {
          // Default to create_task (fail-closed behavior)
          llmLogger.info({
            requestId,
            userId: request.user.id,
            event: 'database_operation',
            operation: 'create_task',
            isFailClosed: validatedTaskData.intent !== 'create_task'
          }, 'Executing task creation operation');
          
          const insertResult = await dbClient.query(
            'INSERT INTO tasks (id, user_id, task_name, due_date, is_completed, original_request) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5) RETURNING id, task_name, due_date, is_completed, original_request, is_archived',
            [request.user.id, validatedTaskData.task_name, validatedTaskData.due_date, validatedTaskData.is_completed, validatedTaskData.original_request]
          );
          
          llmLogger.info({
            requestId,
            userId: request.user.id,
            event: 'database_operation_success',
            operation: 'create_task',
            taskId: insertResult.rows[0].id
          }, 'Task created successfully');
          
          reply.status(201).send(insertResult.rows[0]);
        }
      } catch (dbError) {
        fastify.log.error('Database error during task operation:', dbError);
        throw dbError; // Re-throw to be caught by outer catch
      } finally {
        dbClient.release();
      }

    } catch (error) {
      llmLogger.error({
        requestId,
        userId: request.user?.id,
        event: 'request_failed',
        error: error.message,
        stack: error.stack
      }, 'Error processing task from voice');
      
      reply.status(500).send({ error: 'Failed to process task from voice.', details: error.message });
    }
  });

  fastify.post('/api/openai-task-suggestion', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    try {
      // If OpenAI client is not initialized, use fallback immediately
      if (!openai) {
        fastify.log.warn('OpenAI API key not configured, using fallback');
        return reply.send({ suggestion: 'Consider organizing your desk.', fallback: true });
      }

      const timeoutPromise = new Promise((resolve, reject) => {
        setTimeout(() => {
          reject(new Error('OpenAI API call timed out after 3 seconds'));
        }, 3000);
      });

      // Use reusable prompt template
      const prompt = buildTaskSuggestionPrompt();
      
      const openaiCallPromise = openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{
          role: "user",
          content: prompt
        }],
      });

      const response = await Promise.race([
        openaiCallPromise,
        timeoutPromise
      ]);

      reply.send({ suggestion: response.choices[0].message.content });

    } catch (error) {
      fastify.log.error('OpenAI API error:', error);

      // Fallback mechanism (you can expand this to use another LLM or a predefined list)
      reply.send({ suggestion: 'Consider organizing your desk.', fallback: true });
    }
  });

  fastify.delete('/api/tasks/:id', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params;
      const client = await pool.connect();
      const result = await client.query(
        'DELETE FROM tasks WHERE id = $1 AND user_id = $2 RETURNING id',
        [id, request.user.id]
      );
      client.release();

      if (result.rowCount === 0) {
        reply.status(404).send({ error: 'Task not found or user not authorized.' });
      } else {
        reply.status(204).send(); // No Content
      }
    } catch (err) {
      fastify.log.error(err);
      reply.status(500).send({ error: 'Internal Server Error' });
    }
  });

  fastify.put('/api/tasks/:id', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params;
      const { task_name, description, due_date } = request.body;

      const client = await pool.connect();
      const result = await client.query(
        `UPDATE tasks
         SET task_name = COALESCE($1, task_name),
             description = COALESCE($2, description),
             due_date = COALESCE($3, due_date),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $4 AND user_id = $5
         RETURNING id, task_name, description, due_date, is_completed, original_request, is_archived`,
        [task_name, description, due_date, id, request.user.id]
      );
      client.release();

      if (result.rowCount === 0) {
        reply.status(404).send({ error: 'Task not found or user not authorized.' });
      } else {
        reply.status(200).send(result.rows[0]);
      }
    } catch (err) {
      fastify.log.error(err);
      reply.status(500).send({ error: 'Internal Server Error' });
    }
  });

  fastify.put('/api/tasks/:id/archive', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params;
      const { is_archived } = request.body;

      if (typeof is_archived !== 'boolean') {
        return reply.status(400).send({ error: 'Invalid value for is_archived. Must be a boolean.' });
      }

      const client = await pool.connect();
      const result = await client.query(
        'UPDATE tasks SET is_archived = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND user_id = $3 RETURNING id, is_archived',
        [is_archived, id, request.user.id]
      );
      client.release();

      if (result.rowCount === 0) {
        reply.status(404).send({ error: 'Task not found or user not authorized.' });
      } else {
        reply.status(200).send(result.rows[0]);
      }
    } catch (err) {
      fastify.log.error(err);
      reply.status(500).send({ error: 'Internal Server Error' });
    }
  });

  // Catch-all route for debugging 404s
  fastify.setNotFoundHandler((request, reply) => {
    fastify.log.warn(`=== 404 Not Found ===`);
    fastify.log.warn(`Method: ${request.method}`);
    fastify.log.warn(`URL: ${request.url}`);
    fastify.log.warn(`Path: ${request.routeOptions?.url || 'N/A'}`);
    fastify.log.warn(`Query: ${JSON.stringify(request.query)}`);
    reply.status(404).send({ error: 'Route not found', path: request.url });
  });

  // Log all registered routes for debugging
  fastify.ready(() => {
    fastify.log.info('=== Registered Routes ===');
    const routes = fastify.printRoutes();
    fastify.log.info(routes);
  });

  return fastify;
}

if (process.env.NODE_ENV !== 'test') {
  const start = async () => {
    const app = buildApp();
    
    // Retry logic for database connection
    const connectWithRetry = async (maxRetries = 10, delayMs = 1000) => {
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          app.log.info(`Attempting to connect to database (attempt ${attempt}/${maxRetries})...`);
          app.log.info(`Database config: host=${process.env.DB_HOST}, database=${process.env.DB_NAME}, user=${process.env.DB_USER}`);
          
          const client = await app.pool.connect();
          app.log.info('Successfully connected to database');
          return client;
        } catch (error) {
          app.log.warn(`Database connection attempt ${attempt} failed: ${error.message}`);
          
          if (attempt === maxRetries) {
            throw new Error(`Failed to connect to database after ${maxRetries} attempts: ${error.message}`);
          }
          
          const waitTime = delayMs * attempt; // Exponential backoff
          app.log.info(`Waiting ${waitTime}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    };
    
    // Wait for database initialization before starting the server
    try {
      const client = await connectWithRetry();
      
      try {
        // Create users table
        app.log.info('Creating users table...');
        await client.query(`
          CREATE TABLE IF NOT EXISTS users (
            id VARCHAR(255) PRIMARY KEY,
            email VARCHAR(255) NOT NULL,
            name VARCHAR(255),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `);
        app.log.info('Users table created successfully');
        
        app.log.info('Creating users email index...');
        await client.query(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);`);
        app.log.info('Users email index created successfully');

        // Create tasks table
        app.log.info('Creating tasks table...');
        await client.query(`
          CREATE TABLE IF NOT EXISTS tasks (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id VARCHAR(255) NOT NULL,
            task_name TEXT NOT NULL,
            description TEXT,
            due_date DATE,
            is_completed BOOLEAN DEFAULT FALSE,
            original_request TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            is_archived BOOLEAN DEFAULT FALSE
          );
        `);
        
        // Add description column if it doesn't exist (for existing databases)
        app.log.info('Adding description column if it doesn\'t exist...');
        await client.query(`
          ALTER TABLE tasks
          ADD COLUMN IF NOT EXISTS description TEXT;
        `);
        app.log.info('Tasks table created successfully');
        
        app.log.info('Creating tasks indexes...');
        await client.query(`CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_tasks_is_archived ON tasks(is_archived);`);
        app.log.info('Tasks indexes created successfully');

        app.log.info('Database schema initialized successfully');
      } finally {
        client.release();
      }
    } catch (error) {
      app.log.error(`Error initializing database schema: ${error.message}`);
      if (error.stack) {
        app.log.error(`Stack trace: ${error.stack}`);
      }
      process.exit(1);
    }
    
    try {
      await app.listen({ port: 3000, host: '0.0.0.0' });
    } catch (err) {
      app.log.error(err);
      process.exit(1);
    }
  };
  start();
}

export default buildApp;

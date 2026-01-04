/**
 * Task Routes
 * 
 * Extracted from backend/app.js:564-1394
 * 
 * Handles all task-related operations including:
 * - Fetching tasks
 * - Creating tasks from voice input
 * - Updating tasks
 * - Deleting tasks (with confirmation)
 * - Archiving tasks
 * - Task suggestions
 */

import crypto from 'crypto';
import { processUserInput } from '../inputProcessor.js';
import { buildTaskParsingPrompt, buildTaskSuggestionPrompt, sanitizeUserInput } from '../promptTemplates.js';
import { validateLLMTaskOutput, createSafeFallbackTask, sanitizeForDatabase } from '../src/schemas/task.schema.js';

// In-memory store for pending delete confirmations
// Extracted from backend/app.js:23
const pendingDeleteTasks = new Map();

export default async function taskRoutes(fastify, options) {
  const { pool, openai, requesty, llmLogger } = options;

  // GET /api/tasks - Fetch all tasks for authenticated user
  // Extracted from backend/app.js:564-581
  fastify.get('/api/tasks', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    try {
      const client = await pool.connect();
      const showArchived = request.query.showArchived === 'true';
      const query = showArchived 
        ? 'SELECT * FROM tasks WHERE user_id = $1 ORDER BY due_date ASC NULLS FIRST'
        : 'SELECT * FROM tasks WHERE user_id = $1 AND is_archived = FALSE ORDER BY due_date ASC NULLS FIRST';
      const result = await client.query(
        query,
        [request.user.id]
      );
      client.release();
      reply.send(result.rows);
    } catch (err) {
      fastify.log.error(err);
      reply.status(500).send({ error: 'Internal Server Error' });
    }
  });

  // GET /protected - Test endpoint for authentication
  // Extracted from backend/app.js:583-585
  fastify.get('/protected', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    return { user: request.user };
  });

  // POST /api/tasks/create-from-voice - Create or update task from voice input
  // Extracted from backend/app.js:711-1173
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
        // Business logic validation: edit_task and delete_task require valid task_id
        if ((validatedTaskData.intent === "edit_task" || validatedTaskData.intent === "delete_task") && validatedTaskData.task_id) {
          // Verify task exists and belongs to user before allowing edit or delete
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
              originalIntent: validatedTaskData.intent,
              newIntent: 'create_task',
              taskId: validatedTaskData.task_id,
              reason: 'task_not_found_or_unauthorized',
              securitySignal: 'INTENT_DOWNGRADE'
            }, `Task not found or unauthorized for ${validatedTaskData.intent} - failing closed to create_task`);
            
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
              original_request = COALESCE($4, original_request),
              message_id = COALESCE($5, message_id),
              updated_at = CURRENT_TIMESTAMP
            WHERE id = $6 AND user_id = $7
            RETURNING id, task_name, due_date, is_completed, original_request, is_archived, message_id;
          `;
          const updateResult = await dbClient.query(
            updateQuery,
            [
              validatedTaskData.task_name,
              validatedTaskData.due_date,
              validatedTaskData.is_completed,
              validatedTaskData.original_request,
              validatedTaskData.message_id,
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
        } else if (validatedTaskData.intent === "delete_task" && validatedTaskData.task_id) {
          llmLogger.info({
            requestId,
            userId: request.user.id,
            event: 'delete_confirmation_requested',
            operation: 'delete_task',
            taskId: validatedTaskData.task_id
          }, 'Requesting deletion confirmation from user');

          // Generate a unique confirmation ID
          const confirmationId = crypto.randomBytes(16).toString('hex');
          
          // Store the pending deletion with a 10-second timeout
          const timeoutId = setTimeout(() => {
            // Remove the pending deletion after timeout
            if (pendingDeleteTasks.has(confirmationId)) {
              pendingDeleteTasks.delete(confirmationId);
              llmLogger.info({
                requestId,
                userId: request.user.id,
                event: 'delete_confirmation_timeout',
                confirmationId,
                taskId: validatedTaskData.task_id
              }, 'Delete confirmation timed out after 10 seconds');
            }
          }, 10000); // 10 seconds

          // Store the pending deletion
          pendingDeleteTasks.set(confirmationId, {
            taskId: validatedTaskData.task_id,
            userId: request.user.id,
            requestId,
            timeoutId,
            createdAt: Date.now()
          });

          llmLogger.info({
            requestId,
            userId: request.user.id,
            event: 'delete_confirmation_pending',
            confirmationId,
            taskId: validatedTaskData.task_id
          }, 'Delete confirmation pending');

          // Send confirmation prompt to frontend
          reply.status(202).send({
            requiresConfirmation: true,
            confirmationId,
            taskId: validatedTaskData.task_id,
            message: 'Please confirm task deletion',
            timeoutSeconds: 10
          });
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

  // POST /api/tasks/confirm-delete/:confirmationId - Handle delete confirmation
  // Extracted from backend/app.js:1175-1277
  fastify.post('/api/tasks/confirm-delete/:confirmationId', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { confirmationId } = request.params;
      const { confirmed } = request.body;

      llmLogger.info({
        userId: request.user.id,
        event: 'delete_confirmation_received',
        confirmationId,
        confirmed
      }, 'Delete confirmation response received');

      // Check if the confirmation exists
      const pendingDelete = pendingDeleteTasks.get(confirmationId);

      if (!pendingDelete) {
        llmLogger.warn({
          userId: request.user.id,
          event: 'delete_confirmation_not_found',
          confirmationId
        }, 'Confirmation ID not found or expired');
        
        return reply.status(404).send({ error: 'Confirmation not found or expired.' });
      }

      // Verify the user owns this confirmation
      if (pendingDelete.userId !== request.user.id) {
        llmLogger.warn({
          userId: request.user.id,
          event: 'delete_confirmation_unauthorized',
          confirmationId,
          expectedUserId: pendingDelete.userId
        }, 'User does not own this confirmation');
        
        return reply.status(403).send({ error: 'Unauthorized.' });
      }

      // Clear the timeout
      clearTimeout(pendingDelete.timeoutId);

      // Remove from pending map
      pendingDeleteTasks.delete(confirmationId);

      if (confirmed === true) {
        // User confirmed - proceed with deletion
        llmLogger.info({
          requestId: pendingDelete.requestId,
          userId: request.user.id,
          event: 'delete_confirmed',
          confirmationId,
          taskId: pendingDelete.taskId
        }, 'User confirmed deletion - proceeding');

        const client = await pool.connect();
        try {
          const deleteResult = await client.query(
            'DELETE FROM tasks WHERE id = $1 AND user_id = $2 RETURNING id',
            [pendingDelete.taskId, request.user.id]
          );

          if (deleteResult.rowCount === 0) {
            llmLogger.error({
              requestId: pendingDelete.requestId,
              userId: request.user.id,
              event: 'database_operation_failed',
              operation: 'delete_task',
              taskId: pendingDelete.taskId,
              reason: 'task_not_found'
            }, 'Task deletion failed - task not found');
            
            reply.status(404).send({ error: 'Task not found or user not authorized for deletion.' });
          } else {
            llmLogger.info({
              requestId: pendingDelete.requestId,
              userId: request.user.id,
              event: 'database_operation_success',
              operation: 'delete_task',
              taskId: pendingDelete.taskId
            }, 'Task deleted successfully after confirmation');
            
            reply.status(204).send(); // No Content
          }
        } finally {
          client.release();
        }
      } else {
        // User cancelled or denied
        llmLogger.info({
          requestId: pendingDelete.requestId,
          userId: request.user.id,
          event: 'delete_cancelled',
          confirmationId,
          taskId: pendingDelete.taskId
        }, 'User cancelled deletion');

        reply.status(200).send({ message: 'Deletion cancelled.' });
      }
    } catch (error) {
      fastify.log.error('Error processing delete confirmation:', error);
      reply.status(500).send({ error: 'Failed to process confirmation.', details: error.message });
    }
  });

  // POST /api/openai-task-suggestion - Get AI task suggestion
  // Extracted from backend/app.js:1279-1317
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

  // DELETE /api/tasks/:id - Delete a task
  // Extracted from backend/app.js:1319-1338
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

  // PUT /api/tasks/:id - Update a task
  // Extracted from backend/app.js:1340-1367
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

  // PUT /api/tasks/:id/archive - Archive/unarchive a task
  // Extracted from backend/app.js:1369-1394
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
}

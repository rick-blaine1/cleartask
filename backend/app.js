import Fastify from 'fastify';
import pg from 'pg';
import fastifyJwt from '@fastify/jwt';
import fastifyOAuth2 from '@fastify/oauth2';
import cors from '@fastify/cors';
import OpenAI from "openai";

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

  fastify.post('/api/tasks/create-from-voice', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    try {
      const { transcribedText, clientDate, clientTimezoneOffset } = request.body;

      if (!transcribedText) {
        return reply.status(400).send({ error: 'Transcribed text is required.' });
      }

      let taskDetails = null;
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

      const existingTasksContext = existingTasks.length > 0
        ? `\n\n# EXISTING TASKS\nThe user currently has these tasks:\n${existingTasks.map(t => `- ID: ${t.id}, Name: "${t.task_name}", Due: ${t.due_date || 'No date'}, Completed: ${t.is_completed}`).join('\n')}`
        : '\n\n# EXISTING TASKS\nThe user has no existing tasks.';

      const prompt = `Think Hard about this.
      # ROLE 
      You are a world class personal assistant. If presented with an incomplete time, assume that it is in the current year and relative to today.

      # CONTEXT
      Today is ${currentTimeForLLM}${existingTasksContext}

      # TASK
      Parse the following transcribed text into a JSON object. The JSON object should contain the following fields:
      - task_name (string): The name of the task.
      - due_date (string, YYYY-MM-DD or null): The due date of the task.
      - is_completed (boolean): Whether the task is completed.
      - original_request (string): The original transcribed text.
      - intent (string): Categorize the user's intent as either "create_task" or "edit_task". If the user is referring to an existing task (e.g., "mark X as done", "change X to Y", "complete X"), set this to "edit_task".
      - task_id (string or null): If the intent is "edit_task", provide the ID of the task being edited by matching the user's description to the existing tasks list above. Otherwise, this should be null.

      Transcribed text: "${transcribedText}"
      Example for create_task:
      {
        "task_name": "Buy groceries",
        "due_date": "2025-12-31",
        "is_completed": false,
        "original_request": "I need to buy groceries by the end of the year.",
        "intent": "create_task",
        "task_id": null
      }
      Example for edit_task:
      {
        "task_name": "Call mom",
        "due_date": "2025-12-25",
        "is_completed": false,
        "original_request": "Change call dad to call mom and make it due for christmas",
        "intent": "edit_task",
        "task_id": "a1b2c3d4-e5f6-7890-1234-567890abcdef"
      }
      `;
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
          taskDetails = await callLLM(requesty, "openai/gpt-4o-mini", 5000);
          llmUsed = 'Requesty';
          fastify.log.info('Task parsed successfully using Requesty.');
        } catch (requestyError) {
          fastify.log.warn('Requesty failed or timed out, falling back to OpenAI:', requestyError.message);
          // Fallback to OpenAI if Requesty fails
          if (openai) {
            try {
              taskDetails = await callLLM(openai, "gpt-4o-mini", 3000);
              llmUsed = 'OpenAI';
              fastify.log.info('Task parsed successfully using OpenAI fallback.');
            } catch (openaiError) {
              fastify.log.error('OpenAI fallback also failed:', openaiError.message);
            }
          }
        }
      } else if (openai) {
        // If Requesty is not configured, try OpenAI directly
        try {
          taskDetails = await callLLM(openai, "gpt-3.5-turbo", 3000);
          llmUsed = 'OpenAI';
          fastify.log.info('Task parsed successfully using OpenAI.');
        } catch (openaiError) {
          fastify.log.error('OpenAI API call failed:', openaiError.message);
        }
      }

      // If both fail or are not configured, use a simple fallback
      if (!taskDetails) {
        fastify.log.warn('No LLM configured or all LLMs failed, using simple fallback for task parsing.');
        taskDetails = {
          task_name: transcribedText,
          due_date: null,
          is_completed: false,
          original_request: transcribedText,
          intent: "create_task",
          task_id: null
        };
        llmUsed = 'Fallback';
      }

      fastify.log.info(`LLM used for task parsing: ${llmUsed}`);
      fastify.log.info(`Task details to be processed: ${JSON.stringify(taskDetails)}`);
      fastify.log.info(`Intent detected: ${taskDetails.intent}, Task ID: ${taskDetails.task_id}`);

      const dbClient = await pool.connect();
      try {
        if (taskDetails.intent === "edit_task" && taskDetails.task_id) {
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
              taskDetails.task_name,
              taskDetails.due_date,
              taskDetails.is_completed,
              taskDetails.original_request,
              taskDetails.task_id,
              request.user.id
            ]
          );

          if (updateResult.rowCount === 0) {
            reply.status(404).send({ error: 'Task not found or user not authorized for update.' });
          } else {
            reply.status(200).send(updateResult.rows[0]);
          }
        } else {
          const insertResult = await dbClient.query(
            'INSERT INTO tasks (id, user_id, task_name, due_date, is_completed, original_request) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5) RETURNING id, task_name, due_date, is_completed, original_request, is_archived',
            [request.user.id, taskDetails.task_name, taskDetails.due_date, taskDetails.is_completed, taskDetails.original_request]
          );
          reply.status(201).send(insertResult.rows[0]);
        }
      } catch (dbError) {
        fastify.log.error('Database error during task operation:', dbError);
        throw dbError; // Re-throw to be caught by outer catch
      } finally {
        dbClient.release();
      }

    } catch (error) {
      fastify.log.error('Error processing task from voice:', error);
      fastify.log.error('Error stack:', error.stack);
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

      const openaiCallPromise = openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [{
          role: "user",
          content: "Suggest a simple task for a todo list."
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
            due_date DATE,
            is_completed BOOLEAN DEFAULT FALSE,
            original_request TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            is_archived BOOLEAN DEFAULT FALSE
          );
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

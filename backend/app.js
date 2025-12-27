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
      const result = await client.query(
        'SELECT * FROM tasks WHERE user_id = $1 AND is_completed = false ORDER BY due_date ASC NULLS FIRST',
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

      const prompt = `Think Hard about this.
      # ROLE 
      You are a world class personal assistant. If presented with an incomplete time, assume that it is in the current year and relative to today.

      # CONTEXT
      Today is ${currentTimeForLLM}

      # TASK
      Parse the following transcribed text into a JSON object with fields: task_name (string), due_date (string, YYYY-MM-DD or null), is_completed (boolean), original_request (string).
      Transcribed text: "${transcribedText}"
      Example:
      {
        "task_name": "Buy groceries",
        "due_date": "2025-12-31",
        "is_completed": false,
        "original_request": "I need to buy groceries by the end of the year."
      }`;

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
        };
        llmUsed = 'Fallback';
      }

      fastify.log.info(`LLM used for task parsing: ${llmUsed}`);
      fastify.log.info(`Task details to be inserted: ${JSON.stringify(taskDetails)}`);

      const client = await pool.connect();
      try {
        const insertResult = await client.query(
          'INSERT INTO tasks (id, user_id, task_name, due_date, is_completed, original_request) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5) RETURNING id, task_name, due_date, is_completed, original_request',
          [request.user.id, taskDetails.task_name, taskDetails.due_date, taskDetails.is_completed, taskDetails.original_request]
        );
        client.release();
        reply.status(201).send(insertResult.rows[0]);
      } catch (dbError) {
        client.release();
        fastify.log.error('Database error during task insertion:', dbError);
        throw dbError; // Re-throw to be caught by outer catch
      }

    } catch (error) {
      fastify.log.error('Error creating task from voice:', error);
      fastify.log.error('Error stack:', error.stack);
      reply.status(500).send({ error: 'Failed to create task from voice.', details: error.message });
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

  return fastify;
}

if (process.env.NODE_ENV !== 'test') {
  const start = async () => {
    const app = buildApp();
    
    // Wait for database initialization before starting the server
    try {
      const client = await app.pool.connect();
      try {
        // Create users table
        await client.query(`
          CREATE TABLE IF NOT EXISTS users (
            id VARCHAR(255) PRIMARY KEY,
            email VARCHAR(255) NOT NULL,
            name VARCHAR(255),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
          CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
        `);

        // Create tasks table
        await client.query(`
          CREATE TABLE IF NOT EXISTS tasks (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id VARCHAR(255) NOT NULL,
            task_name TEXT NOT NULL,
            due_date DATE,
            is_completed BOOLEAN DEFAULT FALSE,
            original_request TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
          CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);
          CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
        `);

        app.log.info('Database schema initialized successfully');
      } finally {
        client.release();
      }
    } catch (error) {
      app.log.error('Error initializing database schema:', error);
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

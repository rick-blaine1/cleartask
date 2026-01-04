/**
 * Database Initialization
 * 
 * Extracted from backend/app.js:1449-1642
 * 
 * Handles database schema initialization with retry logic.
 * Creates all necessary tables and indexes for the application.
 */

/**
 * Connect to database with retry logic
 * 
 * @param {Object} pool - PostgreSQL connection pool
 * @param {Object} logger - Fastify logger instance
 * @param {number} maxRetries - Maximum number of connection attempts
 * @param {number} delayMs - Initial delay between retries in milliseconds
 * @returns {Promise<Object>} Database client connection
 */
export async function connectWithRetry(pool, logger, maxRetries = 10, delayMs = 1000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.info(`Attempting to connect to database (attempt ${attempt}/${maxRetries})...`);
      logger.info(`Database config from docker-compose: host=${process.env.DB_HOST}, database=${process.env.DB_NAME}, user=${process.env.DB_USER}, port=${process.env.DB_PORT}`);
      logger.info(`Database config from .env: host=${process.env.POSTGRES_HOST}, database=${process.env.POSTGRES_DB}, user=${process.env.POSTGRES_USER}, port=${process.env.POSTGRES_PORT}`);
      logger.info(`Pool will use: host=${process.env.POSTGRES_HOST || 'localhost'}, database=${process.env.POSTGRES_DB || 'cleartaskdb'}, user=${process.env.POSTGRES_USER || 'user'}, port=${process.env.POSTGRES_PORT || 5432}`);
      
      const client = await pool.connect();
      logger.info('Successfully connected to database');
      return client;
    } catch (error) {
      logger.warn(`Database connection attempt ${attempt} failed: ${error.message}`);
      logger.warn(`Error details: ${JSON.stringify({
        code: error.code,
        errno: error.errno,
        syscall: error.syscall,
        hostname: error.hostname,
        address: error.address
      })}`);
      logger.warn(`Stack trace: ${error.stack}`);

      
      if (attempt === maxRetries) {
        throw new Error(`Failed to connect to database after ${maxRetries} attempts: ${error.message}`);
      }
      
      const waitTime = delayMs * attempt; // Exponential backoff
      logger.info(`Waiting ${waitTime}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
}

/**
 * Initialize database schema
 * 
 * Creates all tables and indexes required by the application.
 * Uses CREATE TABLE IF NOT EXISTS and ADD COLUMN IF NOT EXISTS for idempotency.
 * 
 * @param {Object} client - PostgreSQL client connection
 * @param {Object} logger - Fastify logger instance
 */
export async function initializeSchema(client, logger) {
  // Create users table
  logger.info('Creating users table...');
  await client.query(`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(255) PRIMARY KEY,
      email VARCHAR(255) NOT NULL,
      name VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  logger.info('Users table created successfully');
  
  logger.info('Creating users email index...');
  await client.query(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);`);
  logger.info('Users email index created successfully');

  // Create tasks table
  logger.info('Creating tasks table...');
  await client.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id VARCHAR(255) NOT NULL,
      task_name TEXT NOT NULL,
      description TEXT,
      due_date DATE,
      is_completed BOOLEAN DEFAULT FALSE,
      original_request TEXT,
      message_id VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      is_archived BOOLEAN DEFAULT FALSE
    );
  `);
  
  // Add description column if it doesn't exist (for existing databases)
  logger.info('Adding description column if it doesn\'t exist...');
  await client.query(`
    ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS description TEXT;
  `);

  // Add message_id column if it doesn't exist
  logger.info('Adding message_id column if it doesn\'t exist...');
  await client.query(`
    ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS message_id VARCHAR(255);
  `);

  // Add original_request column if it doesn't exist
  logger.info('Adding original_request column if it doesn\'t exist...');
  await client.query(`
    ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS original_request TEXT;
  `);
  logger.info('Tasks table created successfully');
  
  logger.info('Creating tasks indexes...');
  await client.query(`CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_tasks_is_archived ON tasks(is_archived);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_tasks_message_id ON tasks(message_id);`);
  logger.info('Tasks indexes created successfully');

  // Create user_authorized_senders table
  logger.info('Creating user_authorized_senders table...');
  await client.query(`
    CREATE TABLE IF NOT EXISTS user_authorized_senders (
      id SERIAL PRIMARY KEY,
      user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
email_address VARCHAR(255) NOT NULL,
      is_verified BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);
  logger.info('User authorized senders table created successfully');

  logger.info('Creating user_authorized_senders indexes...');
  await client.query(`CREATE INDEX IF NOT EXISTS idx_user_authorized_senders_user_id ON user_authorized_senders (user_id);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_user_authorized_senders_email_address ON user_authorized_senders (email_address);`);
  
  // Add composite UNIQUE constraint on (user_id, email_address) to allow same email for different users
  logger.info('Adding composite UNIQUE constraint on (user_id, email_address)...');
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'user_authorized_senders_user_email_unique'
      ) THEN
        ALTER TABLE user_authorized_senders
        ADD CONSTRAINT user_authorized_senders_user_email_unique
        UNIQUE (user_id, email_address);
      END IF;
    END $$;
  `);
  logger.info('Composite UNIQUE constraint added successfully');
  
  logger.info('User authorized senders indexes created successfully');

  // Create email_verification_tokens table for magic link
  logger.info('Creating email_verification_tokens table...');
  await client.query(`
    CREATE TABLE IF NOT EXISTS email_verification_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      email VARCHAR(255) NOT NULL,
      token VARCHAR(255) UNIQUE NOT NULL,
      expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
      used_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);
  logger.info('Email verification tokens table created successfully');

  logger.info('Creating email_verification_tokens indexes...');
  await client.query(`CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_user_id ON email_verification_tokens (user_id);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_token ON email_verification_tokens (token);`);
  logger.info('Email verification tokens indexes created successfully');

  // Create email_processing_lock table
  logger.info('Creating email_processing_lock table...');
  await client.query(`
    CREATE TABLE IF NOT EXISTS email_processing_lock (
      message_id VARCHAR(255) PRIMARY KEY,
      processed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);
  logger.info('Email processing lock table created successfully');

  logger.info('Creating email_processing_lock index...');
  await client.query(`CREATE INDEX IF NOT EXISTS idx_email_processing_lock_message_id ON email_processing_lock (message_id);`);
  logger.info('Email processing lock index created successfully');

  // Create system_email_ledger table
  logger.info('Creating system_email_ledger table...');
  await client.query(`
    CREATE TABLE IF NOT EXISTS system_email_ledger (
      id SERIAL PRIMARY KEY,
      sent_at TIMESTAMP WITH TIME ZONE NOT NULL,
      purpose VARCHAR(100) NOT NULL,
      recipient_email VARCHAR(255) NOT NULL,
      status VARCHAR(50) NOT NULL
    );
  `);
  logger.info('System email ledger table created successfully');

  logger.info('Creating system_email_ledger index on sent_at...');
  await client.query(`CREATE INDEX IF NOT EXISTS idx_system_email_ledger_sent_at ON system_email_ledger (sent_at);`);
  logger.info('System email ledger index created successfully');

  // Create gmail_sync_state table
  logger.info('Creating gmail_sync_state table...');
  await client.query(`
    CREATE TABLE IF NOT EXISTS gmail_sync_state (
      id SERIAL PRIMARY KEY,
      email_address VARCHAR(255) NOT NULL UNIQUE,
      history_id VARCHAR(255) NOT NULL,
      watch_expiration TIMESTAMP WITH TIME ZONE,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);
  logger.info('Gmail sync state table created successfully');

  logger.info('Creating gmail_sync_state index...');
  await client.query(`CREATE INDEX IF NOT EXISTS idx_gmail_sync_state_email ON gmail_sync_state (email_address);`);
  logger.info('Gmail sync state index created successfully');
  
  // Add UNIQUE constraint to email_address if it doesn't exist (for existing databases)
  logger.info('Adding UNIQUE constraint to gmail_sync_state.email_address if it doesn\'t exist...');
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'gmail_sync_state_email_address_key'
      ) THEN
        ALTER TABLE gmail_sync_state
        ADD CONSTRAINT gmail_sync_state_email_address_key
        UNIQUE (email_address);
      END IF;
    END $$;
  `);
  logger.info('UNIQUE constraint on gmail_sync_state.email_address ensured');

  logger.info('Database schema initialized successfully');
}

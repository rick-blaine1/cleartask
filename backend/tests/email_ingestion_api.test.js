import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import buildApp from '../app.js';
import pg from 'pg';
import { randomUUID } from 'crypto';

// Mock the isSenderVerified function
import * as emailVerification from '../src/email_ingestion/emailVerification.js';
import * as emailSchema from '../src/schemas/email.schema.js';
import sinon from 'sinon';

let app;
let pool;
let client;
let isSenderVerifiedStub;
let emailVerificationSchemaParseStub;

// Helper to generate a valid JWT token for a given userId
async function generateJwt(userId) {
  const token = app.jwt.sign({ userId });
  return token;
}

test.before(async () => {
  // Use a separate test database
  process.env.DB_NAME = process.env.TEST_DB_NAME || 'cleartask_testdb';
  process.env.JWT_SECRET = 'supersecretjwtkey'; // Consistent JWT secret for testing

  app = await buildApp();
  await app.listen({ port: 0 }); // Use a random free port

  pool = new pg.Pool({
    user: process.env.DB_USER || 'user',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'cleartask_testdb',
    password: process.env.DB_PASSWORD || 'password',
    port: process.env.DB_PORT || 5432,
  });

  app.decorate('pool', pool);

  client = await pool.connect();

  // Create tables for testing
  await client.query(`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(255) PRIMARY KEY,
      email VARCHAR(255) NOT NULL,
      name VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS email_authorized_senders (
      id SERIAL PRIMARY KEY,
      user_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
      email_address VARCHAR(255) NOT NULL UNIQUE,
      is_verified BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS email_processing_lock (
      message_id VARCHAR(255) PRIMARY KEY,
      processed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  isSenderVerifiedStub = sinon.stub(emailVerification, 'isSenderVerified');
  emailVerificationSchemaParseStub = sinon.stub(emailSchema.emailIngestionSchema, 'parse');
});

test.beforeEach(async () => {
  // Clear tables before each test
  await client.query('DELETE FROM email_processing_lock');
  await client.query('DELETE FROM email_authorized_senders');
  await client.query('DELETE FROM users');
  
  isSenderVerifiedStub.resetBehavior();
  isSenderVerifiedStub.returns(Promise.resolve(true)); // Default to verified
  emailVerificationSchemaParseStub.resetBehavior();
  emailVerificationSchemaParseStub.callsFake((value) => {
    // Simulate original schema behavior
    if (!value || typeof value !== 'object') {
      throw new Error('Invalid input');
    }
    if (!value.sender || typeof value.sender !== 'string') {
      throw new Error('Sender is required and must be a string');
    }
    if (!/\S+@\S+\.\S+/.test(value.sender)) {
      throw new Error('Sender must be a valid email format');
    }
    if (!value.subject || typeof value.subject !== 'string') {
      throw new Error('Subject is required and must be a string');
    }
    if (!value.body || typeof value.body !== 'string') {
      throw new Error('Body is required and must be a string');
    }
    if (!value.messageId || typeof value.messageId !== 'string') {
      throw new Error('MessageId is required and must be a string');
    }
    return {
      sender: value.sender,
      subject: value.subject,
      body: value.body,
      messageId: value.messageId,
    };
  });
});

test.after(async () => {
  await client.query('DROP TABLE IF EXISTS email_processing_lock');
  await client.query('DROP TABLE IF EXISTS email_authorized_senders');
  await client.query('DROP TABLE IF EXISTS users');
  await client.release();
  await pool.end();
  await app.close();
  sinon.restore();
});

test('POST /api/email-ingestion - valid email ingestion', async (t) => {
  await t.test('should successfully ingest a valid email', async () => {
    const userId = randomUUID();
    const token = await generateJwt(userId);
    const emailData = {
      sender: 'test@example.com',
      subject: 'Test Subject',
      body: 'This is the email body.',
      messageId: '<test-message-123@example.com>',
    };

    // Ensure the sender is authorized for this user
    await client.query(
      'INSERT INTO users (id, email, name) VALUES ($1, $2, $3)',
      [userId, 'user@example.com', 'Test User']
    );
    await client.query(
      'INSERT INTO email_authorized_senders (user_id, email_address, is_verified) VALUES ($1, $2, TRUE)',
      [userId, emailData.sender]
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/email-ingestion',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      payload: emailData,
    });

    assert.strictEqual(response.statusCode, 200, 'Expected status code 200 for valid ingestion');
    assert.deepStrictEqual(response.json(), {
      message: 'Email ingestion endpoint hit and validated successfully.',
      data: emailData,
    }, 'Expected success message and data');

    // Verify messageId was added to lock table
    const { rows } = await client.query('SELECT * FROM email_processing_lock WHERE message_id = $1', [emailData.messageId]);
    assert.strictEqual(rows.length, 1, 'MessageId should be in the lock table');
    assert.strictEqual(rows[0].message_id, emailData.messageId, 'MessageId in lock table should match');
  });

  await t.test('should allow ingestion if sender is not present in authorized_senders table but isSenderVerified returns true', async () => {
    isSenderVerifiedStub.returns(Promise.resolve(true)); // Explicitly set to true
    const userId = randomUUID();
    const token = await generateJwt(userId);
    const emailData = {
      sender: 'new_sender@example.com',
      subject: 'New Sender Email',
      body: 'Content from a new sender.',
      messageId: '<new-sender-message-456@example.com>',
    };

    await client.query(
      'INSERT INTO users (id, email, name) VALUES ($1, $2, $3)',
      [userId, 'user@example.com', 'Test User']
    );
    // Do NOT insert into email_authorized_senders

    const response = await app.inject({
      method: 'POST',
      url: '/api/email-ingestion',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      payload: emailData,
    });

    assert.strictEqual(response.statusCode, 200, 'Expected status code 200 for ingestion with new verified sender');
    assert.deepStrictEqual(response.json(), {
      message: 'Email ingestion endpoint hit and validated successfully.',
      data: emailData,
    }, 'Expected success message and data');
    const { rows } = await client.query('SELECT * FROM email_processing_lock WHERE message_id = $1', [emailData.messageId]);
    assert.strictEqual(rows.length, 1, 'MessageId should be in the lock table');
  });
});

test('POST /api/email-ingestion - invalid input handling', async (t) => {
  const userId = randomUUID();
  const token = await generateJwt(userId);

  // Ensure user exists for authentication
  await client.query(
    'INSERT INTO users (id, email, name) VALUES ($1, $2, $3)',
    [userId, 'user@example.com', 'Test User']
  );

  await t.test('should return 400 for missing sender', async () => {
    emailVerificationSchemaParseStub.throws(new Error('Sender is required and must be a string'));
    const emailData = {
      subject: 'Test Subject',
      body: 'This is the email body.',
      messageId: '<test-message-123@example.com>',
    };

    const response = await app.inject({
      method: 'POST',
      url: '/api/email-ingestion',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      payload: emailData,
    });

    assert.strictEqual(response.statusCode, 400, 'Expected status code 400 for missing sender');
    assert.deepStrictEqual(response.json().message, 'Validation failed', 'Expected validation failed message');
  });

  await t.test('should return 400 for invalid email format for sender', async () => {
    emailVerificationSchemaParseStub.throws(new Error('Sender must be a valid email format'));
    const emailData = {
      sender: 'invalid-email',
      subject: 'Test Subject',
      body: 'This is the email body.',
      messageId: '<test-message-123@example.com>',
    };

    const response = await app.inject({
      method: 'POST',
      url: '/api/email-ingestion',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      payload: emailData,
    });

    assert.strictEqual(response.statusCode, 400, 'Expected status code 400 for invalid sender format');
    assert.deepStrictEqual(response.json().message, 'Validation failed', 'Expected validation failed message');
  });

  await t.test('should return 400 for missing subject', async () => {
    emailVerificationSchemaParseStub.throws(new Error('Subject is required and must be a string'));
    const emailData = {
      sender: 'test@example.com',
      body: 'This is the email body.',
      messageId: '<test-message-123@example.com>',
    };

    const response = await app.inject({
      method: 'POST',
      url: '/api/email-ingestion',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      payload: emailData,
    });

    assert.strictEqual(response.statusCode, 400, 'Expected status code 400 for missing subject');
    assert.deepStrictEqual(response.json().message, 'Validation failed', 'Expected validation failed message');
  });

  await t.test('should return 400 for missing body', async () => {
    emailVerificationSchemaParseStub.throws(new Error('Body is required and must be a string'));
    const emailData = {
      sender: 'test@example.com',
      subject: 'Test Subject',
      messageId: '<test-message-123@example.com>',
    };

    const response = await app.inject({
      method: 'POST',
      url: '/api/email-ingestion',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      payload: emailData,
    });

    assert.strictEqual(response.statusCode, 400, 'Expected status code 400 for missing body');
    assert.deepStrictEqual(response.json().message, 'Validation failed', 'Expected validation failed message');
  });

  await t.test('should return 400 for missing messageId', async () => {
    emailVerificationSchemaParseStub.throws(new Error('MessageId is required and must be a string'));
    const emailData = {
      sender: 'test@example.com',
      subject: 'Test Subject',
      body: 'This is the email body.',
    };

    const response = await app.inject({
      method: 'POST',
      url: '/api/email-ingestion',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      payload: emailData,
    });

    assert.strictEqual(response.statusCode, 400, 'Expected status code 400 for missing messageId');
    assert.deepStrictEqual(response.json().message, 'Validation failed', 'Expected validation failed message');
  });

  await t.test('should return 403 if sender is not verified', async () => {
    isSenderVerifiedStub.returns(Promise.resolve(false)); // Explicitly set to unverified
    const emailData = {
      sender: 'unverified@example.com',
      subject: 'Unauthorized Email',
      body: 'This email should be rejected.',
      messageId: '<unverified-message-789@example.com>',
    };

    // Ensure user exists for authentication
    await client.query(
      'INSERT INTO users (id, email, name) VALUES ($1, $2, $3)',
      [userId, 'user@example.com', 'Test User']
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/email-ingestion',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      payload: emailData,
    });

    assert.strictEqual(response.statusCode, 403, 'Expected status code 403 for unverified sender');
    assert.deepStrictEqual(response.json(), { message: 'Sender email address is not authorized.' }, 'Expected unauthorized message');
    const { rows } = await client.query('SELECT * FROM email_processing_lock WHERE message_id = $1', [emailData.messageId]);
    assert.strictEqual(rows.length, 0, 'MessageId should NOT be in the lock table for unverified sender');
  });
});

test('POST /api/email-ingestion - unauthorized access attempts', async (t) => {
  await t.test('should return 401 if no authorization token is provided', async () => {
    const emailData = {
      sender: 'test@example.com',
      subject: 'Test Subject',
      body: 'This is the email body.',
      messageId: '<test-message-123@example.com>',
    };

    const response = await app.inject({
      method: 'POST',
      url: '/api/email-ingestion',
      payload: emailData,
    });

    assert.strictEqual(response.statusCode, 401, 'Expected status code 401 for no token');
    assert.deepStrictEqual(response.json(), { message: 'Unauthorized' }, 'Expected unauthorized message');
  });

  await t.test('should return 401 if an invalid authorization token is provided', async () => {
    const emailData = {
      sender: 'test@example.com',
      subject: 'Test Subject',
      body: 'This is the email body.',
      messageId: '<test-message-123@example.com>',
    };

    const response = await app.inject({
      method: 'POST',
      url: '/api/email-ingestion',
      headers: {
        Authorization: `Bearer invalid-token`,
      },
      payload: emailData,
    });

    assert.strictEqual(response.statusCode, 401, 'Expected status code 401 for invalid token');
    assert.deepStrictEqual(response.json(), { message: 'Unauthorized' }, 'Expected unauthorized message');
  });
});

import { test, before, after } from 'node:test';
import assert from 'node:assert';
import pg from 'pg';
import { checkDailyEmailLimit, sendTransactionalEmail, DailyLimitReachedError } from '../src/email_ingestion/emailService.js';

const { Pool } = pg;
let pool;

before(async () => {
  pool = new Pool({
    user: process.env.POSTGRES_USER || 'user',
    host: process.env.POSTGRES_HOST || 'localhost',
    database: process.env.POSTGRES_DB || 'cleartaskdb',
    password: process.env.POSTGRES_PASSWORD || 'password',
    port: process.env.POSTGRES_PORT || 5432,
  });

  const client = await pool.connect();
  try {
    // Ensure table exists and is empty for tests
    await client.query(`
      CREATE TABLE IF NOT EXISTS system_email_ledger (
        id SERIAL PRIMARY KEY,
        sent_at TIMESTAMP WITH TIME ZONE NOT NULL,
        purpose VARCHAR(100) NOT NULL,
        recipient_email VARCHAR(255) NOT NULL,
        status VARCHAR(50) NOT NULL
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_system_email_ledger_sent_at ON system_email_ledger (sent_at);`);
    await client.query('TRUNCATE TABLE system_email_ledger RESTART IDENTITY;');
  } finally {
    client.release();
  }
});

after(async () => {
  await pool.end();
});

test('checkDailyEmailLimit returns false when limit is not reached', async () => {
  const client = await pool.connect();
  try {
    await client.query(
      'INSERT INTO system_email_ledger (sent_at, purpose, recipient_email, status) VALUES (NOW() - INTERVAL \'1 hour\', $1, $2, $3)',
      ['magic_link_verification', 'test@example.com', 'sent']
    );
    const limitReached = await checkDailyEmailLimit(pool);
    assert.strictEqual(limitReached, false);
  } finally {
    await client.query('TRUNCATE TABLE system_email_ledger RESTART IDENTITY;');
    client.release();
  }
});

test('checkDailyEmailLimit returns true when limit is reached', async () => {
  const client = await pool.connect();
  try {
    // Insert 90 emails for today
    for (let i = 0; i < 90; i++) {
      await client.query(
        'INSERT INTO system_email_ledger (sent_at, purpose, recipient_email, status) VALUES (NOW(), $1, $2, $3)',
        ['magic_link_verification', `test${i}@example.com`, 'sent']
      );
    }
    const limitReached = await checkDailyEmailLimit(pool);
    assert.strictEqual(limitReached, true);
  } finally {
    await client.query('TRUNCATE TABLE system_email_ledger RESTART IDENTITY;');
    client.release();
  }
});

test('sendTransactionalEmail sends email and logs success when limit not reached', async () => {
  const initialEnv = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = 'test_resend_key'; // Mock Resend API Key

  const mockFetch = global.fetch; // Store original fetch
  global.fetch = async (url, options) => {
    assert.strictEqual(url, 'https://api.resend.com/emails');
    assert.strictEqual(options.method, 'POST');
    assert.strictEqual(options.headers['Authorization'], 'Bearer test_resend_key');
    assert.ok(options.body.includes('test@example.com'));
    return { ok: true, json: async () => ({ id: 'email_sent_id' }) };
  };

  const client = await pool.connect();
  try {
    await sendTransactionalEmail(pool, 'test@example.com', 'Test Subject', 'Test HTML', 'test_purpose');

    const result = await client.query(
      'SELECT * FROM system_email_ledger WHERE recipient_email = $1 AND status = $2',
      ['test@example.com', 'sent']
    );
    assert.strictEqual(result.rowCount, 1);
    assert.strictEqual(result.rows[0].purpose, 'test_purpose');
  } finally {
    await client.query('TRUNCATE TABLE system_email_ledger RESTART IDENTITY;');
    process.env.RESEND_API_KEY = initialEnv;
    global.fetch = mockFetch; // Restore original fetch
    client.release();
  }
});

test('sendTransactionalEmail throws DailyLimitReachedError when limit is reached', async () => {
  const client = await pool.connect();
  try {
    // Fill up the daily limit
    for (let i = 0; i < 90; i++) {
      await client.query(
        'INSERT INTO system_email_ledger (sent_at, purpose, recipient_email, status) VALUES (NOW(), $1, $2, $3)',
        ['magic_link_verification', `limit_test${i}@example.com`, 'sent']
      );
    }

    await assert.rejects(
      () => sendTransactionalEmail(pool, 'test@example.com', 'Test Subject', 'Test HTML', 'test_purpose'),
      (err) => {
        assert.strictEqual(err.name, 'DailyLimitReachedError');
        assert.ok(typeof err.resetTime === 'string');
        return true;
      }
    );
  } finally {
    await client.query('TRUNCATE TABLE system_email_ledger RESTART IDENTITY;');
    client.release();
  }
});

test('sendTransactionalEmail logs failed status on Resend API error', async () => {
  const initialEnv = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = 'test_resend_key';

  const mockFetch = global.fetch;
  global.fetch = async (url, options) => {
    return { ok: false, statusText: 'Bad Request', json: async () => ({ message: 'Invalid API Key' }) };
  };

  const client = await pool.connect();
  try {
    await assert.rejects(
      () => sendTransactionalEmail(pool, 'fail@example.com', 'Fail Subject', 'Fail HTML', 'fail_purpose'),
      (err) => {
        assert.ok(err.message.includes('Failed to send email'));
        return true;
      }
    );

    const result = await client.query(
      'SELECT * FROM system_email_ledger WHERE recipient_email = $1 AND status = $2',
      ['fail@example.com', 'failed']
    );
    assert.strictEqual(result.rowCount, 1);
    assert.strictEqual(result.rows[0].purpose, 'fail_purpose');
  } finally {
    await client.query('TRUNCATE TABLE system_email_ledger RESTART IDENTITY;');
    process.env.RESEND_API_KEY = initialEnv;
    global.fetch = mockFetch;
    client.release();
  }
});

test('DailyLimitReachedError has correct properties', () => {
  const resetTime = new Date().toISOString();
  const error = new DailyLimitReachedError('Test message', resetTime);
  assert.strictEqual(error.name, 'DailyLimitReachedError');
  assert.strictEqual(error.message, 'Test message');
  assert.strictEqual(error.resetTime, resetTime);
});

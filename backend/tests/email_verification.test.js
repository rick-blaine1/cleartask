import { test, before, after } from 'node:test';
import assert from 'node:assert';
import supertest from 'supertest';
import buildApp from '../app.js';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

let app;
let pool;
let request;

before(async () => {
    // Set up a test database environment
    process.env.NODE_ENV = 'test';
    process.env.DB_NAME = process.env.TEST_DB_NAME || 'cleartaskdb_test';
    process.env.JWT_SECRET = 'test_jwt_secret';
    process.env.FRONTEND_URL = 'http://localhost:5173';

    app = buildApp();
    await app.ready(); // Ensure plugins are loaded and database is initialized

    pool = app.pool;
    request = supertest(app.server);

    // Clear test database before running tests
    const client = await pool.connect();
    try {
        await client.query('DROP TABLE IF EXISTS email_verification_tokens CASCADE;');
        await client.query('DROP TABLE IF EXISTS user_authorized_senders CASCADE;');
        await client.query('DROP TABLE IF EXISTS users CASCADE;');
        await client.query('DROP TABLE IF EXISTS tasks CASCADE;');
        await client.query('DROP TABLE IF EXISTS email_inbox CASCADE;');
        await client.query('DROP TABLE IF EXISTS email_processing_lock CASCADE;');
        // Re-initialize schema
        await app.close(); // Close to re-run schema initialization
        app = buildApp();
        await app.ready();
    } finally {
        client.release();
    }
});

after(async () => {
    // Clean up test database
    const client = await pool.connect();
    try {
        await client.query('DROP TABLE IF EXISTS email_verification_tokens CASCADE;');
        await client.query('DROP TABLE IF EXISTS user_authorized_senders CASCADE;');
        await client.query('DROP TABLE IF EXISTS users CASCADE;');
        await client.query('DROP TABLE IF EXISTS tasks CASCADE;');
        await client.query('DROP TABLE IF EXISTS email_inbox CASCADE;');
        await client.query('DROP TABLE IF EXISTS email_processing_lock CASCADE;');
    } finally {
        client.release();
    }
    await app.close();
});

test('verifying an invalid magic link should fail', async (t) => {
    const client = await pool.connect();
    const userId = 'test-user-uuid-4';
    const userEmail = 'invalid@example.com';
    const invalidToken = 'invalid-token';

    try {
        // 1. Create a user
        await client.query(
            'INSERT INTO users (id, email, name) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name',
            [userId, userEmail, 'Test User 4']
        );

        // 2. Attempt to verify with an invalid token
        const verifyMagicLinkRes = await request
            .get(`/api/email-ingestion/verify-magic-link?token=${invalidToken}`)
            .expect(400);

        assert.strictEqual(verifyMagicLinkRes.body.message, 'Invalid, expired, or already used magic link.', 'Verification of invalid link should fail');

        // Ensure sender is NOT authorized
        const authorizedSenderResult = await client.query(
            'SELECT id FROM user_authorized_senders WHERE user_id = $1 AND email_address = $2',
            [userId, userEmail]
        );
        assert.strictEqual(authorizedSenderResult.rowCount, 0, 'Sender should not be authorized after invalid link verification attempt');

    } finally {
        client.release();
    }
});

test('email verification flow should correctly store verified sender in user_authorized_senders', async (t) => {
    const client = await pool.connect();
    const userId = 'test-user-uuid';
    const userEmail = 'test@example.com';
    let verificationToken = '';

    try {
        // 1. Create a user
        await client.query(
            'INSERT INTO users (id, email, name) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name',
            [userId, userEmail, 'Test User']
        );

        // Generate JWT for the user
        const token = app.jwt.sign({ userId });

        // 2. Request a magic link
        const requestMagicLinkRes = await request
            .post('/api/email-ingestion/request-magic-link')
            .set('Authorization', `Bearer ${token}`)
            .send({ email: userEmail })
            .expect(200);

        assert.strictEqual(requestMagicLinkRes.body.message, 'Magic link sent to your email address.', 'Magic link request should be successful');

        // Retrieve the token from the database
        const tokenResult = await client.query(
            'SELECT token FROM email_verification_tokens WHERE user_id = $1 AND email = $2',
            [userId, userEmail]
        );
        assert.strictEqual(tokenResult.rowCount, 1, 'Token should be stored in the database');
        verificationToken = tokenResult.rows[0].token;

        // 3. Verify the magic link
        const verifyMagicLinkRes = await request
            .get(`/api/email-ingestion/verify-magic-link?token=${verificationToken}`)
            .expect(200);

        assert.strictEqual(verifyMagicLinkRes.body.message, 'Email verified successfully.', 'Email verification should be successful');

        // 4. Check if the sender is authorized and verified in the database
        const authorizedSenderResult = await client.query(
            'SELECT email_address, is_verified FROM user_authorized_senders WHERE user_id = $1 AND email_address = $2',
            [userId, userEmail]
        );

        assert.strictEqual(authorizedSenderResult.rowCount, 1, 'Sender should be added to user_authorized_senders');
        assert.strictEqual(authorizedSenderResult.rows[0].email_address, userEmail, 'Stored email address should match');
        assert.strictEqual(authorizedSenderResult.rows[0].is_verified, true, 'is_verified should be true');

        // Verify that the token is marked as used
        const usedTokenResult = await client.query(
            'SELECT used_at FROM email_verification_tokens WHERE token = $1',
            [verificationToken]
        );
        assert.notStrictEqual(usedTokenResult.rows[0].used_at, null, 'used_at should be set after verification');

    } finally {
        client.release();
    }
});

test('requesting magic link for already verified email should return success without re-verification', async (t) => {
    const client = await pool.connect();
    const userId = 'test-user-uuid-2';
    const userEmail = 'verified@example.com';

    try {
        // 1. Create a user
        await client.query(
            'INSERT INTO users (id, email, name) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name',
            [userId, userEmail, 'Test User 2']
        );

        // 2. Manually add a verified sender entry
        await client.query(
            'INSERT INTO user_authorized_senders (user_id, email_address, is_verified) VALUES ($1, $2, TRUE)',
            [userId, userEmail]
        );

        // Generate JWT for the user
        const token = app.jwt.sign({ userId });

        // 3. Request a magic link for the already verified email
        const requestMagicLinkRes = await request
            .post('/api/email-ingestion/request-magic-link')
            .set('Authorization', `Bearer ${token}`)
            .send({ email: userEmail })
            .expect(200);

        assert.strictEqual(requestMagicLinkRes.body.message, 'Email is already verified.', 'Magic link request for already verified email should be successful');

        // Ensure no new token was created
        const tokenResult = await client.query(
            'SELECT id FROM email_verification_tokens WHERE user_id = $1 AND email = $2',
            [userId, userEmail]
        );
        assert.strictEqual(tokenResult.rowCount, 0, 'No new verification token should be created for an already verified email');

    } finally {
        client.release();
    }
});

test('verifying an expired magic link should fail', async (t) => {
    const client = await pool.connect();
    const userId = 'test-user-uuid-3';
    const userEmail = 'expired@example.com';
    const expiredToken = 'expired-token';
    const expiredAt = new Date(Date.now() - 3600 * 1000); // 1 hour ago

    try {
        // 1. Create a user
        await client.query(
            'INSERT INTO users (id, email, name) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name',
            [userId, userEmail, 'Test User 3']
        );

        // 2. Insert an expired token into the database
        await client.query(
            'INSERT INTO email_verification_tokens (user_id, email, token, expires_at) VALUES ($1, $2, $3, $4)',
            [userId, userEmail, expiredToken, expiredAt]
        );

        // 3. Attempt to verify the expired magic link
        const verifyMagicLinkRes = await request
            .get(`/api/email-ingestion/verify-magic-link?token=${expiredToken}`)
            .expect(400);

        assert.strictEqual(verifyMagicLinkRes.body.message, 'Invalid, expired, or already used magic link.', 'Verification of expired link should fail');

        // Ensure sender is NOT authorized
        const authorizedSenderResult = await client.query(
            'SELECT id FROM user_authorized_senders WHERE user_id = $1 AND email_address = $2',
            [userId, userEmail]
        );
        assert.strictEqual(authorizedSenderResult.rowCount, 0, 'Sender should not be authorized after expired link verification attempt');

    } finally {
        client.release();
    }
});

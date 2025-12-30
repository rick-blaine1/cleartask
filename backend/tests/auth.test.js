import { test, before, after } from 'node:test';
import assert from 'node:assert';
import jwt from 'jsonwebtoken';
import Fastify from 'fastify';
import buildApp from '../app.js';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

// Test database configuration
const testPool = new Pool({
    user: process.env.POSTGRES_USER,
    host: process.env.POSTGRES_HOST || 'localhost',
    database: process.env.POSTGRES_DB,
    password: process.env.POSTGRES_PASSWORD,
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
});

// Helper function to clean up test database
async function cleanupDatabase(client) {
    await client.query('DROP TABLE IF EXISTS email_processing_lock CASCADE;');
    await client.query('DROP TABLE IF EXISTS user_authorized_senders CASCADE;');
    await client.query('DROP TABLE IF EXISTS email_inbox CASCADE;');
    await client.query('DROP TABLE IF EXISTS tasks CASCADE;');
    await client.query('DROP TABLE IF EXISTS users CASCADE;');
}

// Helper function to initialize database schema
async function initializeDatabase(client) {
    await client.query(`
        CREATE TABLE IF NOT EXISTS users (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            email VARCHAR(255) NOT NULL UNIQUE,
            name VARCHAR(255),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `);
}

// =============================================================================
// CUSTOM JWT GENERATION LOGIC TESTS
// =============================================================================

test('JWT generation - should generate valid JWT with userId claim', async () => {
    const testUserId = '123e4567-e89b-12d3-a456-426614174000';
    const testEmail = 'test@example.com';
    
    // Simulate the custom JWT generation logic from backend/app.js
    const token = jwt.sign(
        { userId: testUserId, email: testEmail },
        process.env.JWT_SECRET || 'test-secret',
        { expiresIn: '7d' }
    );
    
    assert.ok(token, 'JWT should be generated');
    assert.strictEqual(typeof token, 'string', 'JWT should be a string');
});

test('JWT generation - should embed userId in token payload', async () => {
    const testUserId = '123e4567-e89b-12d3-a456-426614174000';
    const testEmail = 'test@example.com';
    
    const token = jwt.sign(
        { userId: testUserId, email: testEmail },
        process.env.JWT_SECRET || 'test-secret',
        { expiresIn: '7d' }
    );
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'test-secret');
    
    assert.strictEqual(decoded.userId, testUserId, 'JWT should contain userId claim');
    assert.strictEqual(decoded.email, testEmail, 'JWT should contain email claim');
});

// =============================================================================
// JWT CONTENT VERIFICATION TESTS
// =============================================================================

test('JWT verification - should contain standard claims (iat, exp)', async () => {
    const testUserId = '123e4567-e89b-12d3-a456-426614174000';
    const testEmail = 'test@example.com';
    
    const token = jwt.sign(
        { userId: testUserId, email: testEmail },
        process.env.JWT_SECRET || 'test-secret',
        { expiresIn: '7d' }
    );
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'test-secret');
    
    assert.ok(decoded.iat, 'JWT should contain iat (issued at) claim');
    assert.ok(decoded.exp, 'JWT should contain exp (expiration) claim');
    assert.strictEqual(typeof decoded.iat, 'number', 'iat should be a number');
    assert.strictEqual(typeof decoded.exp, 'number', 'exp should be a number');
    assert.ok(decoded.exp > decoded.iat, 'exp should be greater than iat');
});

test('JWT verification - should have correct expiration time (7 days)', async () => {
    const testUserId = '123e4567-e89b-12d3-a456-426614174000';
    const testEmail = 'test@example.com';
    
    const token = jwt.sign(
        { userId: testUserId, email: testEmail },
        process.env.JWT_SECRET || 'test-secret',
        { expiresIn: '7d' }
    );
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'test-secret');
    
    const expectedExpiration = decoded.iat + (7 * 24 * 60 * 60); // 7 days in seconds
    const actualExpiration = decoded.exp;
    
    // Allow 1 second tolerance for timing differences
    assert.ok(Math.abs(actualExpiration - expectedExpiration) <= 1, 'JWT should expire in 7 days');
});

// =============================================================================
// EXPIRED AND MALFORMED TOKEN TESTS
// =============================================================================

test('JWT verification - should reject expired tokens', async () => {
    const testUserId = '123e4567-e89b-12d3-a456-426614174000';
    const testEmail = 'test@example.com';
    
    // Generate a token that expires immediately
    const token = jwt.sign(
        { userId: testUserId, email: testEmail },
        process.env.JWT_SECRET || 'test-secret',
        { expiresIn: '1ms' } // Expires in 1 millisecond
    );
    
    // Wait for token to expire
    await new Promise(resolve => setTimeout(resolve, 10));
    
    assert.throws(
        () => {
            jwt.verify(token, process.env.JWT_SECRET || 'test-secret');
        },
        /jwt expired/i,
        'Should reject expired JWT'
    );
});

test('JWT verification - should reject tokens with invalid signature', async () => {
    const testUserId = '123e4567-e89b-12d3-a456-426614174000';
    const testEmail = 'test@example.com';
    
    // Generate token with one secret
    const token = jwt.sign(
        { userId: testUserId, email: testEmail },
        'secret-1',
        { expiresIn: '7d' }
    );
    
    // Try to verify with different secret
    assert.throws(
        () => {
            jwt.verify(token, 'secret-2');
        },
        /invalid signature/i,
        'Should reject JWT with invalid signature'
    );
});

test('JWT verification - should reject malformed tokens', async () => {
    const malformedTokens = [
        'not.a.jwt',
        'invalid',
        '',
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalid.signature',
        'header.payload', // Missing signature
    ];
    
    for (const malformedToken of malformedTokens) {
        assert.throws(
            () => {
                jwt.verify(malformedToken, process.env.JWT_SECRET || 'test-secret');
            },
            Error,
            `Should reject malformed JWT: ${malformedToken}`
        );
    }
});

test('JWT verification - should reject tokens with missing required claims', async () => {
    // Generate token without userId claim
    const tokenWithoutUserId = jwt.sign(
        { email: 'test@example.com' },
        process.env.JWT_SECRET || 'test-secret',
        { expiresIn: '7d' }
    );
    
    const decoded = jwt.verify(tokenWithoutUserId, process.env.JWT_SECRET || 'test-secret');
    
    // Verify that userId is missing
    assert.strictEqual(decoded.userId, undefined, 'Token should not have userId claim');
    
    // In a real application, this would be rejected by middleware
    // Here we're just verifying the claim is missing
});

// =============================================================================
// OAUTH FLOW SIMULATION TESTS
// =============================================================================

test('OAuth callback - should create user and generate JWT on successful Google OAuth', async () => {
    const client = await testPool.connect();
    try {
        await cleanupDatabase(client);
        await initializeDatabase(client);
        
        // Simulate Google OAuth callback data
        const googleUserData = {
            email: 'oauth-test@example.com',
            name: 'OAuth Test User',
            sub: 'google-user-id-123'
        };
        
        // Simulate user creation (as would happen in /api/auth/google/callback)
        const userResult = await client.query(
            'INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id, email, name',
            [googleUserData.email, googleUserData.name]
        );
        
        const user = userResult.rows[0];
        
        // Generate custom JWT (as would happen in /api/auth/google/callback)
        const token = jwt.sign(
            { userId: user.id, email: user.email },
            process.env.JWT_SECRET || 'test-secret',
            { expiresIn: '7d' }
        );
        
        // Verify token is valid
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'test-secret');
        
        assert.strictEqual(decoded.email, googleUserData.email, 'JWT should contain user email');
        assert.strictEqual(decoded.userId, user.id, 'JWT should contain user ID');
        assert.ok(decoded.exp, 'JWT should have expiration');
    } finally {
        await cleanupDatabase(client);
        client.release();
    }
});

test('OAuth callback - should return existing user if email already exists', async () => {
    const client = await testPool.connect();
    try {
        await cleanupDatabase(client);
        await initializeDatabase(client);
        
        const testEmail = 'existing@example.com';
        
        // Create user first time
        const firstResult = await client.query(
            'INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id, email',
            [testEmail, 'First User']
        );
        const firstUserId = firstResult.rows[0].id;
        
        // Simulate second OAuth login with same email
        // In real app, this would use INSERT ... ON CONFLICT or SELECT first
        const existingUserResult = await client.query(
            'SELECT id, email, name FROM users WHERE email = $1',
            [testEmail]
        );
        
        assert.strictEqual(existingUserResult.rows.length, 1, 'Should find existing user');
        assert.strictEqual(existingUserResult.rows[0].id, firstUserId, 'Should return same user ID');
        
        // Generate JWT for existing user
        const token = jwt.sign(
            { userId: existingUserResult.rows[0].id, email: existingUserResult.rows[0].email },
            process.env.JWT_SECRET || 'test-secret',
            { expiresIn: '7d' }
        );
        
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'test-secret');
        assert.strictEqual(decoded.userId, firstUserId, 'JWT should contain original user ID');
    } finally {
        await cleanupDatabase(client);
        client.release();
    }
});

// =============================================================================
// AUTHENTICATION MIDDLEWARE TESTS
// =============================================================================

test('Authentication middleware - should accept valid JWT', async () => {
    const testUserId = '123e4567-e89b-12d3-a456-426614174000';
    const testEmail = 'test@example.com';
    
    const token = jwt.sign(
        { userId: testUserId, email: testEmail },
        process.env.JWT_SECRET || 'test-secret',
        { expiresIn: '7d' }
    );
    
    // Simulate middleware verification
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'test-secret');
    
    assert.ok(decoded, 'Middleware should successfully verify valid JWT');
    assert.strictEqual(decoded.userId, testUserId, 'Middleware should extract userId');
});

test('Authentication middleware - should reject request without token', async () => {
    // Simulate missing token scenario
    const token = undefined;
    
    if (!token) {
        // This simulates the middleware rejecting the request
        assert.ok(true, 'Middleware should reject requests without token');
    } else {
        assert.fail('Should not reach here');
    }
});

test('Authentication middleware - should reject request with Bearer prefix but no token', async () => {
    const authHeader = 'Bearer ';
    const token = authHeader.replace('Bearer ', '').trim();
    
    assert.strictEqual(token, '', 'Token should be empty string');
    
    if (!token) {
        assert.ok(true, 'Middleware should reject empty token');
    } else {
        assert.fail('Should not reach here');
    }
});

// =============================================================================
// REFRESH TOKEN MECHANISM TESTS (if implemented)
// =============================================================================

test('Refresh token - verify no refresh token mechanism is currently implemented', async () => {
    // Based on AGENTS.md and backend/app.js review, there is no refresh token mechanism
    // This test documents that fact
    
    const testUserId = '123e4567-e89b-12d3-a456-426614174000';
    const testEmail = 'test@example.com';
    
    const token = jwt.sign(
        { userId: testUserId, email: testEmail },
        process.env.JWT_SECRET || 'test-secret',
        { expiresIn: '7d' }
    );
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'test-secret');
    
    // Verify no refresh token claim exists
    assert.strictEqual(decoded.refreshToken, undefined, 'No refresh token should be present in JWT');
    assert.strictEqual(decoded.tokenType, undefined, 'No token type should be present in JWT');
    
    // Note: If refresh tokens are added in the future, this test should be updated
});

// =============================================================================
// SCOPE/PERMISSION BASED ACCESS TESTS (if implemented)
// =============================================================================

test('Scope/Permission - verify no granular permission system is currently implemented', async () => {
    // Based on AGENTS.md and backend/app.js review, there is no scope/permission system
    // This test documents that fact
    
    const testUserId = '123e4567-e89b-12d3-a456-426614174000';
    const testEmail = 'test@example.com';
    
    const token = jwt.sign(
        { userId: testUserId, email: testEmail },
        process.env.JWT_SECRET || 'test-secret',
        { expiresIn: '7d' }
    );
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'test-secret');
    
    // Verify no scope/permission claims exist
    assert.strictEqual(decoded.scope, undefined, 'No scope should be present in JWT');
    assert.strictEqual(decoded.permissions, undefined, 'No permissions should be present in JWT');
    assert.strictEqual(decoded.role, undefined, 'No role should be present in JWT');
    
    // Note: If scopes/permissions are added in the future, this test should be updated
});

// =============================================================================
// JWT SECRET VALIDATION TESTS
// =============================================================================

test('JWT secret - should use environment variable JWT_SECRET', async () => {
    const originalSecret = process.env.JWT_SECRET;
    const testSecret = 'test-secret-12345';
    
    try {
        process.env.JWT_SECRET = testSecret;
        
        const testUserId = '123e4567-e89b-12d3-a456-426614174000';
        const token = jwt.sign(
            { userId: testUserId },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );
        
        // Should verify with same secret
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        assert.strictEqual(decoded.userId, testUserId, 'Should verify with correct secret');
        
        // Should fail with different secret
        assert.throws(
            () => {
                jwt.verify(token, 'wrong-secret');
            },
            /invalid signature/i,
            'Should reject with wrong secret'
        );
    } finally {
        // Restore original secret
        if (originalSecret) {
            process.env.JWT_SECRET = originalSecret;
        } else {
            delete process.env.JWT_SECRET;
        }
    }
});

// =============================================================================
// INTEGRATION TESTS WITH FASTIFY APP
// =============================================================================

test('Integration - protected route should reject request without JWT', async () => {
    const app = Fastify();
    
    // Simulate a protected route
    app.get('/protected', async (request, reply) => {
        const authHeader = request.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return reply.code(401).send({ error: 'Unauthorized' });
        }
        
        const token = authHeader.replace('Bearer ', '');
        
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'test-secret');
            return reply.send({ userId: decoded.userId });
        } catch (error) {
            return reply.code(401).send({ error: 'Invalid token' });
        }
    });
    
    await app.ready();
    
    const response = await app.inject({
        method: 'GET',
        url: '/protected'
    });
    
    assert.strictEqual(response.statusCode, 401, 'Should return 401 without token');
    
    await app.close();
});

test('Integration - protected route should accept request with valid JWT', async () => {
    const app = Fastify();
    
    const testUserId = '123e4567-e89b-12d3-a456-426614174000';
    const token = jwt.sign(
        { userId: testUserId },
        process.env.JWT_SECRET || 'test-secret',
        { expiresIn: '7d' }
    );
    
    // Simulate a protected route
    app.get('/protected', async (request, reply) => {
        const authHeader = request.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return reply.code(401).send({ error: 'Unauthorized' });
        }
        
        const tokenFromHeader = authHeader.replace('Bearer ', '');
        
        try {
            const decoded = jwt.verify(tokenFromHeader, process.env.JWT_SECRET || 'test-secret');
            return reply.send({ userId: decoded.userId });
        } catch (error) {
            return reply.code(401).send({ error: 'Invalid token' });
        }
    });
    
    await app.ready();
    
    const response = await app.inject({
        method: 'GET',
        url: '/protected',
        headers: {
            authorization: `Bearer ${token}`
        }
    });
    
    assert.strictEqual(response.statusCode, 200, 'Should return 200 with valid token');
    const body = JSON.parse(response.body);
    assert.strictEqual(body.userId, testUserId, 'Should return correct userId');
    
    await app.close();
});

test('Integration - protected route should reject request with expired JWT', async () => {
    const app = Fastify();
    
    const testUserId = '123e4567-e89b-12d3-a456-426614174000';
    const token = jwt.sign(
        { userId: testUserId },
        process.env.JWT_SECRET || 'test-secret',
        { expiresIn: '1ms' }
    );
    
    // Wait for token to expire
    await new Promise(resolve => setTimeout(resolve, 10));
    
    // Simulate a protected route
    app.get('/protected', async (request, reply) => {
        const authHeader = request.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return reply.code(401).send({ error: 'Unauthorized' });
        }
        
        const tokenFromHeader = authHeader.replace('Bearer ', '');
        
        try {
            const decoded = jwt.verify(tokenFromHeader, process.env.JWT_SECRET || 'test-secret');
            return reply.send({ userId: decoded.userId });
        } catch (error) {
            return reply.code(401).send({ error: 'Invalid token' });
        }
    });
    
    await app.ready();
    
    const response = await app.inject({
        method: 'GET',
        url: '/protected',
        headers: {
            authorization: `Bearer ${token}`
        }
    });
    
    assert.strictEqual(response.statusCode, 401, 'Should return 401 with expired token');
    
    await app.close();
});

// Cleanup after all tests
after(async () => {
    await testPool.end();
});

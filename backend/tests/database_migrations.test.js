import { test, before, after } from 'node:test';
import assert from 'node:assert';
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

// Helper function to run migrations (simulating app.js initialization)
async function runMigrations(client) {
    await client.query(`
        CREATE TABLE IF NOT EXISTS users (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            email VARCHAR(255) NOT NULL UNIQUE,
            name VARCHAR(255),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);`);
    
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
    await client.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS description TEXT;`);
    await client.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS message_id VARCHAR(255);`);
    await client.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS original_request TEXT;`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_tasks_is_archived ON tasks(is_archived);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_tasks_message_id ON tasks(message_id);`);
    
    await client.query(`
        CREATE TABLE IF NOT EXISTS email_inbox (
            id SERIAL PRIMARY KEY,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            email_address VARCHAR(255) UNIQUE NOT NULL,
            access_token TEXT NOT NULL,
            refresh_token TEXT NOT NULL,
            last_sync_at TIMESTAMP WITH TIME ZONE,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_email_inbox_user_id ON email_inbox (user_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_email_inbox_email_address ON email_inbox (email_address);`);
    
    await client.query(`
        CREATE TABLE IF NOT EXISTS user_authorized_senders (
            id SERIAL PRIMARY KEY,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            email_address VARCHAR(255) UNIQUE NOT NULL,
            is_verified BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_user_authorized_senders_user_id ON user_authorized_senders (user_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_user_authorized_senders_email_address ON user_authorized_senders (email_address);`);
    
    await client.query(`
        CREATE TABLE IF NOT EXISTS email_processing_lock (
            message_id VARCHAR(255) PRIMARY KEY,
            processed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_email_processing_lock_message_id ON email_processing_lock (message_id);`);
}

// Helper function to clean up test database
async function cleanupDatabase(client) {
    await client.query('DROP TABLE IF EXISTS email_processing_lock CASCADE;');
    await client.query('DROP TABLE IF EXISTS user_authorized_senders CASCADE;');
    await client.query('DROP TABLE IF EXISTS email_inbox CASCADE;');
    await client.query('DROP TABLE IF EXISTS tasks CASCADE;');
    await client.query('DROP TABLE IF EXISTS users CASCADE;');
}

// Helper function to get column information
async function getColumnInfo(client, tableName) {
    const result = await client.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_name = $1
        ORDER BY ordinal_position;
    `, [tableName]);
    return result.rows;
}

// Helper function to get constraint information
async function getConstraints(client, tableName) {
    const result = await client.query(`
        SELECT
            tc.constraint_name,
            tc.constraint_type,
            kcu.column_name,
            ccu.table_name AS foreign_table_name,
            ccu.column_name AS foreign_column_name,
            rc.delete_rule
        FROM information_schema.table_constraints AS tc
        LEFT JOIN information_schema.key_column_usage AS kcu
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
        LEFT JOIN information_schema.constraint_column_usage AS ccu
            ON ccu.constraint_name = tc.constraint_name
            AND ccu.table_schema = tc.table_schema
        LEFT JOIN information_schema.referential_constraints AS rc
            ON tc.constraint_name = rc.constraint_name
        WHERE tc.table_name = $1;
    `, [tableName]);
    return result.rows;
}

// =============================================================================
// COMPREHENSIVE SCHEMA VERIFICATION TESTS
// =============================================================================

test('users table - verify column types', async () => {
    const client = await testPool.connect();
    try {
        await cleanupDatabase(client);
        await runMigrations(client);
        
        const columns = await getColumnInfo(client, 'users');
        const columnMap = Object.fromEntries(columns.map(c => [c.column_name, c]));
        
        assert.strictEqual(columnMap.id.data_type, 'uuid', 'id should be uuid type');
        assert.strictEqual(columnMap.email.data_type, 'character varying', 'email should be varchar');
        assert.strictEqual(columnMap.name.data_type, 'character varying', 'name should be varchar');
        assert.strictEqual(columnMap.created_at.data_type, 'timestamp without time zone', 'created_at should be timestamp');
        assert.strictEqual(columnMap.updated_at.data_type, 'timestamp without time zone', 'updated_at should be timestamp');
    } finally {
        await cleanupDatabase(client);
        client.release();
    }
});

test('users table - verify NOT NULL constraints', async () => {
    const client = await testPool.connect();
    try {
        await cleanupDatabase(client);
        await runMigrations(client);
        
        const columns = await getColumnInfo(client, 'users');
        const columnMap = Object.fromEntries(columns.map(c => [c.column_name, c]));
        
        assert.strictEqual(columnMap.id.is_nullable, 'NO', 'id should be NOT NULL');
        assert.strictEqual(columnMap.email.is_nullable, 'NO', 'email should be NOT NULL');
        assert.strictEqual(columnMap.name.is_nullable, 'YES', 'name should be nullable');
        assert.strictEqual(columnMap.created_at.is_nullable, 'YES', 'created_at should be nullable (has default)');
        assert.strictEqual(columnMap.updated_at.is_nullable, 'YES', 'updated_at should be nullable (has default)');
    } finally {
        await cleanupDatabase(client);
        client.release();
    }
});

test('users table - verify UNIQUE constraints', async () => {
    const client = await testPool.connect();
    try {
        await cleanupDatabase(client);
        await runMigrations(client);
        
        const constraints = await getConstraints(client, 'users');
        const uniqueConstraints = constraints.filter(c => c.constraint_type === 'UNIQUE');
        
        assert.ok(uniqueConstraints.some(c => c.column_name === 'email'), 'email should have UNIQUE constraint');
    } finally {
        await cleanupDatabase(client);
        client.release();
    }
});

test('users table - verify default values', async () => {
    const client = await testPool.connect();
    try {
        await cleanupDatabase(client);
        await runMigrations(client);
        
        const columns = await getColumnInfo(client, 'users');
        const columnMap = Object.fromEntries(columns.map(c => [c.column_name, c]));
        
        assert.ok(columnMap.id.column_default?.includes('gen_random_uuid'), 'id should have gen_random_uuid() default');
        assert.ok(columnMap.created_at.column_default?.includes('CURRENT_TIMESTAMP') || 
                  columnMap.created_at.column_default?.includes('now()'), 'created_at should have CURRENT_TIMESTAMP default');
        assert.ok(columnMap.updated_at.column_default?.includes('CURRENT_TIMESTAMP') || 
                  columnMap.updated_at.column_default?.includes('now()'), 'updated_at should have CURRENT_TIMESTAMP default');
    } finally {
        await cleanupDatabase(client);
        client.release();
    }
});

test('email_inbox table - verify column types', async () => {
    const client = await testPool.connect();
    try {
        await cleanupDatabase(client);
        await runMigrations(client);
        
        const columns = await getColumnInfo(client, 'email_inbox');
        const columnMap = Object.fromEntries(columns.map(c => [c.column_name, c]));
        
        assert.strictEqual(columnMap.id.data_type, 'integer', 'id should be integer (SERIAL)');
        assert.strictEqual(columnMap.user_id.data_type, 'uuid', 'user_id should be uuid');
        assert.strictEqual(columnMap.email_address.data_type, 'character varying', 'email_address should be varchar');
        assert.strictEqual(columnMap.access_token.data_type, 'text', 'access_token should be text');
        assert.strictEqual(columnMap.refresh_token.data_type, 'text', 'refresh_token should be text');
        assert.strictEqual(columnMap.last_sync_at.data_type, 'timestamp with time zone', 'last_sync_at should be timestamptz');
        assert.strictEqual(columnMap.created_at.data_type, 'timestamp with time zone', 'created_at should be timestamptz');
    } finally {
        await cleanupDatabase(client);
        client.release();
    }
});

test('email_inbox table - verify NOT NULL constraints', async () => {
    const client = await testPool.connect();
    try {
        await cleanupDatabase(client);
        await runMigrations(client);
        
        const columns = await getColumnInfo(client, 'email_inbox');
        const columnMap = Object.fromEntries(columns.map(c => [c.column_name, c]));
        
        assert.strictEqual(columnMap.id.is_nullable, 'NO', 'id should be NOT NULL');
        assert.strictEqual(columnMap.user_id.is_nullable, 'NO', 'user_id should be NOT NULL');
        assert.strictEqual(columnMap.email_address.is_nullable, 'NO', 'email_address should be NOT NULL');
        assert.strictEqual(columnMap.access_token.is_nullable, 'NO', 'access_token should be NOT NULL');
        assert.strictEqual(columnMap.refresh_token.is_nullable, 'NO', 'refresh_token should be NOT NULL');
        assert.strictEqual(columnMap.last_sync_at.is_nullable, 'YES', 'last_sync_at should be nullable');
    } finally {
        await cleanupDatabase(client);
        client.release();
    }
});

test('email_inbox table - verify UNIQUE constraints', async () => {
    const client = await testPool.connect();
    try {
        await cleanupDatabase(client);
        await runMigrations(client);
        
        const constraints = await getConstraints(client, 'email_inbox');
        const uniqueConstraints = constraints.filter(c => c.constraint_type === 'UNIQUE');
        
        assert.ok(uniqueConstraints.some(c => c.column_name === 'email_address'), 'email_address should have UNIQUE constraint');
    } finally {
        await cleanupDatabase(client);
        client.release();
    }
});

test('email_inbox table - verify default values', async () => {
    const client = await testPool.connect();
    try {
        await cleanupDatabase(client);
        await runMigrations(client);
        
        const columns = await getColumnInfo(client, 'email_inbox');
        const columnMap = Object.fromEntries(columns.map(c => [c.column_name, c]));
        
        assert.ok(columnMap.created_at.column_default?.includes('CURRENT_TIMESTAMP') || 
                  columnMap.created_at.column_default?.includes('now()'), 'created_at should have CURRENT_TIMESTAMP default');
    } finally {
        await cleanupDatabase(client);
        client.release();
    }
});

// =============================================================================
// NEGATIVE TESTING FOR CONSTRAINTS
// =============================================================================

test('users table - attempt to insert NULL into NOT NULL column (email)', async () => {
    const client = await testPool.connect();
    try {
        await cleanupDatabase(client);
        await runMigrations(client);
        
        await assert.rejects(
            async () => {
                await client.query('INSERT INTO users (email, name) VALUES (NULL, $1)', ['Test User']);
            },
            /null value in column "email".*violates not-null constraint/i,
            'Should reject NULL email'
        );
    } finally {
        await cleanupDatabase(client);
        client.release();
    }
});

test('users table - attempt to insert duplicate UNIQUE value (email)', async () => {
    const client = await testPool.connect();
    try {
        await cleanupDatabase(client);
        await runMigrations(client);
        
        const testEmail = 'test@example.com';
        await client.query('INSERT INTO users (email, name) VALUES ($1, $2)', [testEmail, 'User 1']);
        
        await assert.rejects(
            async () => {
                await client.query('INSERT INTO users (email, name) VALUES ($1, $2)', [testEmail, 'User 2']);
            },
            /duplicate key value violates unique constraint/i,
            'Should reject duplicate email'
        );
    } finally {
        await cleanupDatabase(client);
        client.release();
    }
});

test('email_inbox table - attempt to insert invalid foreign key reference', async () => {
    const client = await testPool.connect();
    try {
        await cleanupDatabase(client);
        await runMigrations(client);
        
        const nonExistentUserId = '00000000-0000-0000-0000-000000000000';
        
        await assert.rejects(
            async () => {
                await client.query(
                    'INSERT INTO email_inbox (user_id, email_address, access_token, refresh_token) VALUES ($1, $2, $3, $4)',
                    [nonExistentUserId, 'test@example.com', 'token', 'refresh']
                );
            },
            /violates foreign key constraint/i,
            'Should reject invalid foreign key reference'
        );
    } finally {
        await cleanupDatabase(client);
        client.release();
    }
});

test('email_inbox table - attempt to insert NULL into NOT NULL column (access_token)', async () => {
    const client = await testPool.connect();
    try {
        await cleanupDatabase(client);
        await runMigrations(client);
        
        // First create a valid user
        const userResult = await client.query('INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id', ['test@example.com', 'Test User']);
        const userId = userResult.rows[0].id;
        
        await assert.rejects(
            async () => {
                await client.query(
                    'INSERT INTO email_inbox (user_id, email_address, access_token, refresh_token) VALUES ($1, $2, NULL, $3)',
                    [userId, 'inbox@example.com', 'refresh']
                );
            },
            /null value in column "access_token".*violates not-null constraint/i,
            'Should reject NULL access_token'
        );
    } finally {
        await cleanupDatabase(client);
        client.release();
    }
});

test('email_inbox table - attempt to insert duplicate UNIQUE value (email_address)', async () => {
    const client = await testPool.connect();
    try {
        await cleanupDatabase(client);
        await runMigrations(client);
        
        // Create a valid user
        const userResult = await client.query('INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id', ['test@example.com', 'Test User']);
        const userId = userResult.rows[0].id;
        
        const testEmail = 'inbox@example.com';
        await client.query(
            'INSERT INTO email_inbox (user_id, email_address, access_token, refresh_token) VALUES ($1, $2, $3, $4)',
            [userId, testEmail, 'token1', 'refresh1']
        );
        
        await assert.rejects(
            async () => {
                await client.query(
                    'INSERT INTO email_inbox (user_id, email_address, access_token, refresh_token) VALUES ($1, $2, $3, $4)',
                    [userId, testEmail, 'token2', 'refresh2']
                );
            },
            /duplicate key value violates unique constraint/i,
            'Should reject duplicate email_address'
        );
    } finally {
        await cleanupDatabase(client);
        client.release();
    }
});

test('user_authorized_senders table - attempt to insert invalid foreign key reference', async () => {
    const client = await testPool.connect();
    try {
        await cleanupDatabase(client);
        await runMigrations(client);
        
        const nonExistentUserId = '00000000-0000-0000-0000-000000000000';
        
        await assert.rejects(
            async () => {
                await client.query(
                    'INSERT INTO user_authorized_senders (user_id, email_address) VALUES ($1, $2)',
                    [nonExistentUserId, 'sender@example.com']
                );
            },
            /violates foreign key constraint/i,
            'Should reject invalid foreign key reference'
        );
    } finally {
        await cleanupDatabase(client);
        client.release();
    }
});

// =============================================================================
// FOREIGN KEY BEHAVIOR TESTS
// =============================================================================

test('email_inbox - verify ON DELETE CASCADE behavior', async () => {
    const client = await testPool.connect();
    try {
        await cleanupDatabase(client);
        await runMigrations(client);
        
        // Create parent user
        const userResult = await client.query('INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id', ['test@example.com', 'Test User']);
        const userId = userResult.rows[0].id;
        
        // Create child email_inbox record
        await client.query(
            'INSERT INTO email_inbox (user_id, email_address, access_token, refresh_token) VALUES ($1, $2, $3, $4)',
            [userId, 'inbox@example.com', 'token', 'refresh']
        );
        
        // Verify child exists
        let result = await client.query('SELECT * FROM email_inbox WHERE user_id = $1', [userId]);
        assert.strictEqual(result.rows.length, 1, 'Child record should exist before parent deletion');
        
        // Delete parent
        await client.query('DELETE FROM users WHERE id = $1', [userId]);
        
        // Verify child was cascaded
        result = await client.query('SELECT * FROM email_inbox WHERE user_id = $1', [userId]);
        assert.strictEqual(result.rows.length, 0, 'Child record should be deleted via CASCADE');
    } finally {
        await cleanupDatabase(client);
        client.release();
    }
});

test('user_authorized_senders - verify ON DELETE CASCADE behavior', async () => {
    const client = await testPool.connect();
    try {
        await cleanupDatabase(client);
        await runMigrations(client);
        
        // Create parent user
        const userResult = await client.query('INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id', ['test@example.com', 'Test User']);
        const userId = userResult.rows[0].id;
        
        // Create child user_authorized_senders record
        await client.query(
            'INSERT INTO user_authorized_senders (user_id, email_address) VALUES ($1, $2)',
            [userId, 'sender@example.com']
        );
        
        // Verify child exists
        let result = await client.query('SELECT * FROM user_authorized_senders WHERE user_id = $1', [userId]);
        assert.strictEqual(result.rows.length, 1, 'Child record should exist before parent deletion');
        
        // Delete parent
        await client.query('DELETE FROM users WHERE id = $1', [userId]);
        
        // Verify child was cascaded
        result = await client.query('SELECT * FROM user_authorized_senders WHERE user_id = $1', [userId]);
        assert.strictEqual(result.rows.length, 0, 'Child record should be deleted via CASCADE');
    } finally {
        await cleanupDatabase(client);
        client.release();
    }
});

// =============================================================================
// MIGRATION IDEMPOTENCY TESTS
// =============================================================================

test('running migrations multiple times should not cause errors (idempotency)', async () => {
    const client = await testPool.connect();
    try {
        await cleanupDatabase(client);
        
        // First run
        await runMigrations(client);
        
        // Second run - should not throw errors
        await assert.doesNotReject(
            async () => {
                await runMigrations(client);
            },
            'Second migration run should not throw errors'
        );
        
        // Third run - should still not throw errors
        await assert.doesNotReject(
            async () => {
                await runMigrations(client);
            },
            'Third migration run should not throw errors'
        );
    } finally {
        await cleanupDatabase(client);
        client.release();
    }
});

// Cleanup after all tests
after(async () => {
    await testPool.end();
});

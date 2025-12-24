import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import buildApp from '../app.js';

const { Pool } = pg;
const pool = new Pool({
  user: process.env.DB_USER || 'user',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'cleartaskdb',
  password: process.env.DB_PASSWORD || 'password',
  port: process.env.DB_PORT || 5432,
});

test('Task sorting API', async (t) => {
  const fastify = buildApp();

  // Wait for fastify to be ready
  await fastify.ready();

  // Generate a test JWT token
  const token = fastify.jwt.sign({ sub: 'test_user', id: 'test_user' });

  before(async () => {
    const client = await pool.connect();
    try {
      await client.query('DELETE FROM tasks WHERE user_id = $1', ['test_user']);
      // Seed tasks
      // Task with no date
      await client.query(
        'INSERT INTO tasks (id, user_id, task_name, due_date, is_completed, original_request) VALUES ($1, $2, $3, $4, $5, $6)',
        [randomUUID(), 'test_user', 'Task with no date', null, false, 'task no date']
      );
      // Task due tomorrow
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrow_date_string = tomorrow.toISOString().split('T')[0];
      await client.query(
        'INSERT INTO tasks (id, user_id, task_name, due_date, is_completed, original_request) VALUES ($1, $2, $3, $4, $5, $6)',
        [randomUUID(), 'test_user', 'Task due tomorrow', tomorrow_date_string, false, 'task tomorrow']
      );
    } finally {
      client.release();
    }
  });

  t.after(async () => {
    await fastify.close();
    await pool.end();
  });

  await t.test('GET /api/tasks returns "No Date" tasks at the top', async (subtest) => {
    const response = await fastify.inject({
      method: 'GET',
      url: '/api/tasks',
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    assert.strictEqual(response.statusCode, 200, 'should return a 200 status code');
    const tasks = response.json();
    assert.ok(Array.isArray(tasks), 'should return an array of tasks');
    assert.ok(tasks.length >= 2, 'should return at least two tasks');

    assert.strictEqual(tasks[0].task_name, 'Task with no date', 'The first task should be the one with no due date');
    assert.strictEqual(tasks[0].due_date, null, 'The first task should have a null due_date');

    assert.strictEqual(tasks[1].task_name, 'Task due tomorrow', 'The second task should be the one due tomorrow');
    assert.ok(tasks[1].due_date !== null, 'The second task should have a due_date');
  });
});

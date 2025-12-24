import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';

const { Pool } = pg;

// Database connection pool
const pool = new Pool({
  user: process.env.DB_USER || 'user',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'cleartaskdb',
  password: process.env.DB_PASSWORD || 'password',
  port: Number(process.env.DB_PORT) || 5432,
});

// Backend API URL
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';

// Test user ID
const TEST_USER_ID = 'frontend_integration_test_user';

// Mock JWT token for authentication
let authToken: string;

describe('Frontend Integration Tests - Task Sorting', () => {
  beforeAll(async () => {
    // Generate a valid JWT token for testing
    authToken = jwt.sign(
      { sub: TEST_USER_ID, id: TEST_USER_ID },
      process.env.JWT_SECRET || 'supersecretjwtkey'
    );
  });

  afterAll(async () => {
    // Clean up test data
    const client = await pool.connect();
    try {
      await client.query('DELETE FROM tasks WHERE user_id = $1', [TEST_USER_ID]);
    } finally {
      client.release();
    }
    await pool.end();
  });

  test('Tasks with "No Date" appear at the top of the API response', async () => {
  const client = await pool.connect();
  
  try {
    // Step 1: Clear any existing data for the test user
    await client.query('DELETE FROM tasks WHERE user_id = $1', [TEST_USER_ID]);
    
    // Step 2: Seed the database with test tasks
    
    // Add a task due tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowDateString = tomorrow.toISOString().split('T')[0];
    
    await client.query(
      'INSERT INTO tasks (id, user_id, task_name, due_date, is_completed, original_request) VALUES ($1, $2, $3, $4, $5, $6)',
      [randomUUID(), TEST_USER_ID, 'Task due tomorrow', tomorrowDateString, false, 'task tomorrow']
    );
    
    // Add a task with no due date (should appear first)
    await client.query(
      'INSERT INTO tasks (id, user_id, task_name, due_date, is_completed, original_request) VALUES ($1, $2, $3, $4, $5, $6)',
      [randomUUID(), TEST_USER_ID, 'Task with no date 1', null, false, 'task no date 1']
    );
    
    // Add another task with no due date (should also appear before dated tasks)
    await client.query(
      'INSERT INTO tasks (id, user_id, task_name, due_date, is_completed, original_request) VALUES ($1, $2, $3, $4, $5, $6)',
      [randomUUID(), TEST_USER_ID, 'Task with no date 2', null, false, 'task no date 2']
    );
    
    // Add a task due in 2 days
    const dayAfterTomorrow = new Date();
    dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);
    const dayAfterTomorrowDateString = dayAfterTomorrow.toISOString().split('T')[0];
    
    await client.query(
      'INSERT INTO tasks (id, user_id, task_name, due_date, is_completed, original_request) VALUES ($1, $2, $3, $4, $5, $6)',
      [randomUUID(), TEST_USER_ID, 'Task due in 2 days', dayAfterTomorrowDateString, false, 'task in 2 days']
    );
    
    // Step 3: Make an API call to fetch tasks
    const response = await fetch(`${API_BASE_URL}/api/tasks`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
    });
    
    // Step 4: Assert the response is successful
    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);
    
    // Step 5: Parse the response
    const tasks = await response.json();
    
    // Step 6: Assert tasks are returned in the correct sorted order
    expect(Array.isArray(tasks)).toBe(true);
    expect(tasks.length).toBe(4);
    
    // First two tasks should have null due_date (no date tasks)
    expect(tasks[0].due_date).toBeNull();
    expect(tasks[1].due_date).toBeNull();
    
    // Verify the no-date tasks are the ones we created
    const noDateTaskNames = [tasks[0].task_name, tasks[1].task_name].sort();
    expect(noDateTaskNames).toEqual(['Task with no date 1', 'Task with no date 2']);
    
    // Next two tasks should have due dates (in ascending order)
    expect(tasks[2].due_date).not.toBeNull();
    expect(tasks[3].due_date).not.toBeNull();
    
    // Verify the dated tasks are in the correct order
    expect(tasks[2].task_name).toBe('Task due tomorrow');
    expect(tasks[3].task_name).toBe('Task due in 2 days');
    
    // Verify the dates are in ascending order
    const date1 = new Date(tasks[2].due_date);
    const date2 = new Date(tasks[3].due_date);
    expect(date1.getTime()).toBeLessThan(date2.getTime());
    
  } finally {
    client.release();
  }
  });

  test('Empty database returns empty array', async () => {
    const client = await pool.connect();
    
    try {
      // Clear all tasks for the test user
      await client.query('DELETE FROM tasks WHERE user_id = $1', [TEST_USER_ID]);
      
      // Make API call
      const response = await fetch(`${API_BASE_URL}/api/tasks`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
      });
      
      expect(response.ok).toBe(true);
      const tasks = await response.json();
      
      expect(Array.isArray(tasks)).toBe(true);
      expect(tasks.length).toBe(0);
      
    } finally {
      client.release();
    }
  });

  test('Only tasks with null due_date when no dated tasks exist', async () => {
    const client = await pool.connect();
    
    try {
      // Clear existing data
      await client.query('DELETE FROM tasks WHERE user_id = $1', [TEST_USER_ID]);
      
      // Add only tasks with no due date
      await client.query(
        'INSERT INTO tasks (id, user_id, task_name, due_date, is_completed, original_request) VALUES ($1, $2, $3, $4, $5, $6)',
        [randomUUID(), TEST_USER_ID, 'No date task 1', null, false, 'task 1']
      );
      
      await client.query(
        'INSERT INTO tasks (id, user_id, task_name, due_date, is_completed, original_request) VALUES ($1, $2, $3, $4, $5, $6)',
        [randomUUID(), TEST_USER_ID, 'No date task 2', null, false, 'task 2']
      );
      
      await client.query(
        'INSERT INTO tasks (id, user_id, task_name, due_date, is_completed, original_request) VALUES ($1, $2, $3, $4, $5, $6)',
        [randomUUID(), TEST_USER_ID, 'No date task 3', null, false, 'task 3']
      );
      
      // Make API call
      const response = await fetch(`${API_BASE_URL}/api/tasks`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
      });
      
      expect(response.ok).toBe(true);
      const tasks = await response.json();
      
      expect(Array.isArray(tasks)).toBe(true);
      expect(tasks.length).toBe(3);
      
      // All tasks should have null due_date
      tasks.forEach((task: any) => {
        expect(task.due_date).toBeNull();
      });
      
    } finally {
      client.release();
    }
  });
});

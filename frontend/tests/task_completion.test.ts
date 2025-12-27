import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import jwt from 'jsonwebtoken';

// Backend API URL
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';

// Test user ID
const TEST_USER_ID = 'frontend_task_completion_test_user';

// Mock JWT token for authentication
let authToken: string;

describe('Frontend Integration Tests - Phase 5: Natural Language Task Completion', () => {
  beforeAll(async () => {
    // Generate a valid JWT token for testing
    authToken = jwt.sign(
      { sub: TEST_USER_ID, id: TEST_USER_ID, userId: TEST_USER_ID },
      process.env.JWT_SECRET || 'supersecretjwtkey'
    );
  });

  describe('Mark Task as Done via Voice', () => {
    test('Send transcript "Mark milk as done" and verify is_completed flag is toggled to true', async () => {
      // Step 1: Create a task named "milk" that is not completed
      const createResponse = await fetch(`${API_BASE_URL}/api/tasks/create-from-voice`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          transcribedText: 'buy milk',
          clientDate: new Date().toISOString(),
          clientTimezoneOffset: new Date().getTimezoneOffset()
        })
      });

      expect(createResponse.ok).toBe(true);
      expect(createResponse.status).toBe(201);

      const createdTask = await createResponse.json();
      expect(createdTask.task_name).toBeDefined();
      expect(createdTask.is_completed).toBe(false);
      expect(createdTask.id).toBeDefined();

      const taskId = createdTask.id;

      // Step 2: Send a transcript "Mark milk as done" to toggle completion
      const markDoneResponse = await fetch(`${API_BASE_URL}/api/tasks/create-from-voice`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          transcribedText: 'Mark milk as done',
          clientDate: new Date().toISOString(),
          clientTimezoneOffset: new Date().getTimezoneOffset()
        })
      });

      expect(markDoneResponse.ok).toBe(true);
      expect(markDoneResponse.status).toBe(200);

      const updatedTask = await markDoneResponse.json();

      // Step 3: Verify the is_completed flag is toggled to true
      expect(updatedTask.is_completed).toBe(true);
      expect(updatedTask.id).toBe(taskId);
      expect(updatedTask.task_name).toContain('milk');

      // Step 4: Verify by fetching all tasks
      const tasksResponse = await fetch(`${API_BASE_URL}/api/tasks`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${authToken}`,
        }
      });

      expect(tasksResponse.ok).toBe(true);
      const tasks = await tasksResponse.json();
      
      const milkTask = tasks.find((task: any) => task.id === taskId);
      expect(milkTask).toBeDefined();
      expect(milkTask.is_completed).toBe(true);
    });

    test('Mark task as done with different phrasings', async () => {
      // Test various natural language phrasings for marking tasks as complete
      const phrasings = [
        { create: 'buy eggs', complete: 'mark eggs as complete' },
        { create: 'call dentist', complete: 'complete call dentist' },
        { create: 'water plants', complete: 'finish water plants' }
      ];

      for (const phrasing of phrasings) {
        // Create task
        const createResponse = await fetch(`${API_BASE_URL}/api/tasks/create-from-voice`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            transcribedText: phrasing.create,
            clientDate: new Date().toISOString(),
            clientTimezoneOffset: new Date().getTimezoneOffset()
          })
        });

        const createdTask = await createResponse.json();
        expect(createdTask.is_completed).toBe(false);

        // Mark as complete
        const completeResponse = await fetch(`${API_BASE_URL}/api/tasks/create-from-voice`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            transcribedText: phrasing.complete,
            clientDate: new Date().toISOString(),
            clientTimezoneOffset: new Date().getTimezoneOffset()
          })
        });

        const completedTask = await completeResponse.json();
        expect(completedTask.is_completed).toBe(true);
      }
    });

    test('Toggle task completion status back to incomplete', async () => {
      // Create a task
      const createResponse = await fetch(`${API_BASE_URL}/api/tasks/create-from-voice`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          transcribedText: 'buy bread',
          clientDate: new Date().toISOString(),
          clientTimezoneOffset: new Date().getTimezoneOffset()
        })
      });

      const createdTask = await createResponse.json();
      expect(createdTask.is_completed).toBe(false);

      // Mark as complete
      const completeResponse = await fetch(`${API_BASE_URL}/api/tasks/create-from-voice`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          transcribedText: 'mark bread as done',
          clientDate: new Date().toISOString(),
          clientTimezoneOffset: new Date().getTimezoneOffset()
        })
      });

      const completedTask = await completeResponse.json();
      expect(completedTask.is_completed).toBe(true);

      // Mark as incomplete again
      const incompleteResponse = await fetch(`${API_BASE_URL}/api/tasks/create-from-voice`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          transcribedText: 'mark bread as not done',
          clientDate: new Date().toISOString(),
          clientTimezoneOffset: new Date().getTimezoneOffset()
        })
      });

      const incompleteTask = await incompleteResponse.json();
      expect(incompleteTask.is_completed).toBe(false);
    });
  });

  describe('Error Handling for Task Completion', () => {
    test('Handle completion request for non-existent task', async () => {
      // Try to mark a non-existent task as done
      const response = await fetch(`${API_BASE_URL}/api/tasks/create-from-voice`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          transcribedText: 'mark nonexistent task as done',
          clientDate: new Date().toISOString(),
          clientTimezoneOffset: new Date().getTimezoneOffset()
        })
      });

      // The LLM should either create a new task or return an error
      // Depending on implementation, this could be 201 (new task) or 404 (not found)
      expect([200, 201, 404]).toContain(response.status);
    });

    test('Handle unauthorized completion request', async () => {
      const response = await fetch(`${API_BASE_URL}/api/tasks/create-from-voice`, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer invalid-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          transcribedText: 'mark milk as done',
          clientDate: new Date().toISOString(),
          clientTimezoneOffset: new Date().getTimezoneOffset()
        })
      });

      expect(response.status).toBe(401);
    });
  });
});

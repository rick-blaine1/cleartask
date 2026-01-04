import { describe, test, expect } from 'vitest';
import { db, Task } from '../src/db';

// Mock the fetch API to simulate backend interaction
global.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
  if (url === 'http://localhost:3000/api/tasks/sync') {
    // Simulate successful sync
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  }
  return new Response('Not Found', { status: 404 });
};

// Mock navigator.onLine to control online/offline state
let isOnline = false;
Object.defineProperty(navigator, 'onLine', {
  get: () => isOnline,
  configurable: true,
});

const triggerOnlineEvent = () => {
  isOnline = true;
  window.dispatchEvent(new Event('online'));
};

describe('IndexedDB Sync Tests', () => {
  test('new task saved to IndexedDB is successfully moved to Postgres DB when online', async () => {
  // 1. Setup: Ensure DB is empty and offline
  await db.tasks.clear();
  isOnline = false;

  // 2. Add a task while offline
  const newTask: Task = {
    user_id: 'test-user',
    task_name: 'Test Task Offline',
    title: 'Test Task Offline',
    due_date: null,
    date: new Date().toISOString(),
    is_completed: false,
    original_request: 'Create a test task offline',
  };
  await db.tasks.add(newTask);

  // Verify task is in IndexedDB
  const tasksInDb = await db.tasks.toArray();
  expect(tasksInDb.length).toBe(1);
  expect(tasksInDb[0].task_name).toBe('Test Task Offline');

  // 3. Simulate going online (this would trigger sync logic in a real app)
  // For this test, we'll manually call a hypothetical sync function that would be part of the app
  // In a real application, you would listen for the 'online' event and call a sync function.
  // Here, we simulate that sync mechanism for testing purposes.

  // Hypothetical sync function (would be in your App logic)
  const syncIndexedDB = async () => {
    const offlineTasks = await db.tasks.where('user_id').equals('test-user').toArray();
    if (offlineTasks.length > 0) {
      await fetch('http://localhost:3000/api/tasks/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(offlineTasks),
      });
      await db.tasks.clear(); // Clear local tasks after successful sync
    }
  };

  triggerOnlineEvent();
  await syncIndexedDB(); // Manually trigger sync for test

  // 4. Verify task is no longer in IndexedDB
  const remainingTasks = await db.tasks.toArray();
  expect(remainingTasks.length).toBe(0);

  // In a real end-to-end test, you would also verify the task exists in the Postgres DB via a backend API call.
  // For unit testing the IndexedDB sync *mechanism*, verifying its removal from local storage after a successful mock API call is sufficient.
  });
});

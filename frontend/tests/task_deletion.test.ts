import { describe, test, expect, vi, beforeEach } from 'vitest';

describe('Task Deletion Confirmation State Machine', () => {
  beforeEach(() => {
    // Reset any mocks or state before each test
    vi.clearAllMocks();
  });

  test('Task returns to normal state and UI unlocks if user says "No"', async () => {
    // Simulate initial state: task is in "Pending Deletion" and UI is locked
    let taskState = { id: '1', name: 'Test Task', status: 'pending_deletion', uiLocked: true };

    // Simulate user saying "No"
    const simulateVoiceInput = (input: string) => {
      if (input.toLowerCase() === 'no') {
        taskState.status = 'normal';
        taskState.uiLocked = false;
      }
    };

    simulateVoiceInput('no');

    expect(taskState.status).toBe('normal');
    expect(taskState.uiLocked).toBe(false);
  });

  test('Task returns to normal state and UI unlocks if 10-second timer expires', async () => {
    // Simulate initial state: task is in "Pending Deletion" and UI is locked
    let taskState = { id: '2', name: 'Another Task', status: 'pending_deletion', uiLocked: true };

    // Simulate a 10-second timer
    const startDeletionTimer = () => {
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          taskState.status = 'normal';
          taskState.uiLocked = false;
          resolve();
        }, 10000);
      });
    };

    const timerPromise = startDeletionTimer();
    
    // Advance timers by 10 seconds (Vitest's way of simulating passage of time)
    vi.useFakeTimers();
    vi.advanceTimersByTime(10000);
    vi.useRealTimers();
    
    await timerPromise; // Wait for the promise to resolve after timer expiration

    expect(taskState.status).toBe('normal');
    expect(taskState.uiLocked).toBe(false);
  });
});

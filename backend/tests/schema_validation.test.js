import { describe, it } from 'node:test';
import assert from 'node:assert';
import { validateLLMTaskOutput, createSafeFallbackTask, sanitizeForDatabase } from '../src/schemas/task.schema.js';

describe('Phase 3: LLM Output Schema Validation', () => {
  
  describe('validateLLMTaskOutput', () => {
    
    it('should accept valid create_task output', () => {
      const validOutput = {
        task_name: 'Buy groceries',
        due_date: '2025-12-30T00:00:00.000Z',
        is_completed: false,
        original_request: 'I need to buy groceries tomorrow',
        intent: 'create_task',
        task_id: null
      };
      
      const result = validateLLMTaskOutput(validOutput);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data.task_name, 'Buy groceries');
      assert.strictEqual(result.data.intent, 'create_task');
    });
    
    it('should accept valid edit_task output with UUID', () => {
      const validOutput = {
        task_name: 'Updated task name',
        due_date: null,
        is_completed: true,
        original_request: 'Mark task as complete',
        intent: 'edit_task',
        task_id: '123e4567-e89b-12d3-a456-426614174000'
      };
      
      const result = validateLLMTaskOutput(validOutput);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data.intent, 'edit_task');
      assert.strictEqual(result.data.task_id, '123e4567-e89b-12d3-a456-426614174000');
    });
    
    it('should reject output with invalid intent', () => {
      const invalidOutput = {
        task_name: 'Test task',
        due_date: null,
        is_completed: false,
        original_request: 'Test',
        intent: 'delete_task', // Invalid intent
        task_id: null
      };
      
      const result = validateLLMTaskOutput(invalidOutput);
      assert.strictEqual(result.success, false);
      assert.ok(result.error);
    });
    
    it('should reject output with missing required fields', () => {
      const invalidOutput = {
        due_date: null,
        is_completed: false,
        intent: 'create_task'
        // Missing task_name
      };
      
      const result = validateLLMTaskOutput(invalidOutput);
      assert.strictEqual(result.success, false);
      assert.ok(result.issues);
    });
    
    it('should reject output with empty task_name', () => {
      const invalidOutput = {
        task_name: '',
        due_date: null,
        is_completed: false,
        original_request: 'Test',
        intent: 'create_task',
        task_id: null
      };
      
      const result = validateLLMTaskOutput(invalidOutput);
      assert.strictEqual(result.success, false);
    });
    
    it('should reject output with task_name exceeding max length', () => {
      const invalidOutput = {
        task_name: 'a'.repeat(501), // Exceeds 500 char limit
        due_date: null,
        is_completed: false,
        original_request: 'Test',
        intent: 'create_task',
        task_id: null
      };
      
      const result = validateLLMTaskOutput(invalidOutput);
      assert.strictEqual(result.success, false);
    });
    
    it('should reject output with invalid date format', () => {
      const invalidOutput = {
        task_name: 'Test task',
        due_date: '2025-12-30', // Not ISO datetime format
        is_completed: false,
        original_request: 'Test',
        intent: 'create_task',
        task_id: null
      };
      
      const result = validateLLMTaskOutput(invalidOutput);
      assert.strictEqual(result.success, false);
    });
    
    it('should reject edit_task without task_id', () => {
      const invalidOutput = {
        task_name: 'Test task',
        due_date: null,
        is_completed: false,
        original_request: 'Test',
        intent: 'edit_task',
        task_id: null // Required for edit_task
      };
      
      const result = validateLLMTaskOutput(invalidOutput);
      assert.strictEqual(result.success, false);
      assert.ok(result.error.message.includes('task_id'));
    });
    
    it('should reject output with invalid UUID format', () => {
      const invalidOutput = {
        task_name: 'Test task',
        due_date: null,
        is_completed: false,
        original_request: 'Test',
        intent: 'edit_task',
        task_id: 'not-a-valid-uuid'
      };
      
      const result = validateLLMTaskOutput(invalidOutput);
      assert.strictEqual(result.success, false);
    });
    
    it('should reject output with extra unexpected fields', () => {
      const invalidOutput = {
        task_name: 'Test task',
        due_date: null,
        is_completed: false,
        original_request: 'Test',
        intent: 'create_task',
        task_id: null,
        malicious_field: 'DROP TABLE tasks;' // Extra field
      };
      
      const result = validateLLMTaskOutput(invalidOutput);
      assert.strictEqual(result.success, false);
    });
    
    it('should reject output with non-boolean is_completed', () => {
      const invalidOutput = {
        task_name: 'Test task',
        due_date: null,
        is_completed: 'true', // String instead of boolean
        original_request: 'Test',
        intent: 'create_task',
        task_id: null
      };
      
      const result = validateLLMTaskOutput(invalidOutput);
      assert.strictEqual(result.success, false);
    });
  });
  
  describe('createSafeFallbackTask', () => {
    
    it('should create safe fallback task from original request', () => {
      const originalRequest = 'This is a test request';
      const fallback = createSafeFallbackTask(originalRequest);
      
      assert.strictEqual(fallback.task_name, originalRequest);
      assert.strictEqual(fallback.due_date, null);
      assert.strictEqual(fallback.is_completed, false);
      assert.strictEqual(fallback.intent, 'create_task');
      assert.strictEqual(fallback.task_id, null);
    });
    
    it('should create fallback with email subject format', () => {
      const originalRequest = 'Email content here';
      const subject = 'Important Meeting';
      const fallback = createSafeFallbackTask(originalRequest, subject);
      
      assert.strictEqual(fallback.task_name, 'Review email: Important Meeting');
      assert.strictEqual(fallback.intent, 'create_task');
    });
    
    it('should truncate long task names', () => {
      const longRequest = 'a'.repeat(600);
      const fallback = createSafeFallbackTask(longRequest);
      
      assert.ok(fallback.task_name.length <= 500);
    });
    
    it('should truncate long original requests', () => {
      const longRequest = 'a'.repeat(2500);
      const fallback = createSafeFallbackTask(longRequest);
      
      assert.ok(fallback.original_request.length <= 2000);
    });
  });
  
  describe('sanitizeForDatabase', () => {
    
    it('should sanitize validated data for database', () => {
      const validatedData = {
        task_name: '  Test Task  ',
        due_date: '2025-12-30T00:00:00.000Z',
        is_completed: false,
        original_request: 'Test request',
        intent: 'create_task',
        task_id: null
      };
      
      const sanitized = sanitizeForDatabase(validatedData);
      
      assert.strictEqual(sanitized.task_name, 'Test Task'); // Trimmed
      assert.strictEqual(sanitized.is_completed, false);
      assert.strictEqual(sanitized.intent, 'create_task');
    });
    
    it('should convert null values properly', () => {
      const validatedData = {
        task_name: 'Test',
        due_date: null,
        is_completed: false,
        original_request: null,
        intent: 'create_task',
        task_id: null
      };
      
      const sanitized = sanitizeForDatabase(validatedData);
      
      assert.strictEqual(sanitized.due_date, null);
      assert.strictEqual(sanitized.original_request, null);
      assert.strictEqual(sanitized.task_id, null);
    });
  });
  
  describe('Prompt Injection Attack Scenarios', () => {
    
    it('should reject output attempting SQL injection in task_name', () => {
      const maliciousOutput = {
        task_name: "'; DROP TABLE tasks; --",
        due_date: null,
        is_completed: false,
        original_request: 'Test',
        intent: 'create_task',
        task_id: null
      };
      
      // Should still pass validation (SQL injection is handled by parameterized queries)
      // But demonstrates that validation doesn't prevent all attacks - defense in depth needed
      const result = validateLLMTaskOutput(maliciousOutput);
      assert.strictEqual(result.success, true);
      // The actual SQL injection protection comes from parameterized queries in app.js
    });
    
    it('should reject output with malicious intent override attempt', () => {
      const maliciousOutput = {
        task_name: 'Test',
        due_date: null,
        is_completed: false,
        original_request: 'Test',
        intent: 'admin_delete_all_tasks', // Malicious intent
        task_id: null
      };
      
      const result = validateLLMTaskOutput(maliciousOutput);
      assert.strictEqual(result.success, false);
    });
    
    it('should reject output attempting to inject additional fields', () => {
      const maliciousOutput = {
        task_name: 'Test',
        due_date: null,
        is_completed: false,
        original_request: 'Test',
        intent: 'create_task',
        task_id: null,
        user_id: 'different-user-id', // Attempt to impersonate
        is_admin: true // Attempt privilege escalation
      };
      
      const result = validateLLMTaskOutput(maliciousOutput);
      assert.strictEqual(result.success, false); // Strict mode rejects extra fields
    });
  });
});

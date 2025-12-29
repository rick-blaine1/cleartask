import { z } from 'zod';

/**
 * Schema for validating LLM-parsed task data
 * 
 * This schema enforces strict validation on all LLM outputs before they can
 * trigger any database operations. This is a critical security control against
 * prompt injection attacks.
 * 
 * Security Principles:
 * - LLM output is untrusted and must be validated
 * - Schema violations trigger safe fallback behavior
 * - No LLM output directly triggers side effects
 */

// Valid intent values - strictly enumerated
const VALID_INTENTS = ['create_task', 'edit_task'];

// Maximum field lengths to prevent abuse
const MAX_TASK_NAME_LENGTH = 250;
const MAX_ORIGINAL_REQUEST_LENGTH = 2000;

/**
 * Schema for LLM task parsing output
 * 
 * All fields from the LLM must conform to this schema.
 * Any deviation results in fallback to safe defaults.
 */
export const LLMTaskOutputSchema = z.object({
  // Task name - required, must be non-empty string
  task_name: z.string()
    .min(1, 'Task name cannot be empty')
    .max(MAX_TASK_NAME_LENGTH, `Task name cannot exceed ${MAX_TASK_NAME_LENGTH} characters`)
    .trim(),
  
  // Due date - optional, must be valid YYYY-MM-DD date string or null
  due_date: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Date must be in YYYY-MM-DD format' })
    .refine((date) => {
      // Validate that it's a real date
      const parsed = new Date(date + 'T00:00:00Z');
      return !isNaN(parsed.getTime());
    }, { message: 'Invalid date' })
    .nullable()
    .optional()
    .or(z.null()),
  
  // Completion status - must be boolean
  is_completed: z.boolean()
    .default(false),
  
  // Original user request - required for audit trail
  original_request: z.string()
    .max(MAX_ORIGINAL_REQUEST_LENGTH, `Original request cannot exceed ${MAX_ORIGINAL_REQUEST_LENGTH} characters`)
    .optional()
    .nullable(),
  
  // Intent - must be one of the valid intents
  intent: z.enum(VALID_INTENTS, {
    errorMap: () => ({ message: 'Intent must be either "create_task" or "edit_task"' })
  }),
  
  // Task ID - required only for edit_task intent
  task_id: z.string()
    .uuid({ message: 'Task ID must be a valid UUID' })
    .nullable()
    .optional()
}).strict(); // Reject any additional fields not in schema

/**
 * Validates LLM output against the strict schema
 * 
 * @param {unknown} llmOutput - Raw output from LLM to validate
 * @returns {{ success: true, data: object } | { success: false, error: object }} Validation result
 */
export function validateLLMTaskOutput(llmOutput) {
  try {
    const result = LLMTaskOutputSchema.safeParse(llmOutput);
    
    if (!result.success) {
      return {
        success: false,
        error: result.error,
        issues: result.error.issues
      };
    }
    
    // Additional business logic validation
    // If intent is edit_task, task_id must be present
    if (result.data.intent === 'edit_task' && !result.data.task_id) {
      return {
        success: false,
        error: new Error('edit_task intent requires a valid task_id'),
        issues: [{
          code: 'custom',
          path: ['task_id'],
          message: 'task_id is required when intent is edit_task'
        }]
      };
    }
    
    return {
      success: true,
      data: result.data
    };
  } catch (error) {
    return {
      success: false,
      error: error,
      issues: [{
        code: 'custom',
        path: [],
        message: 'Unexpected validation error'
      }]
    };
  }
}

/**
 * Creates a safe fallback task when LLM output validation fails
 * 
 * This ensures the application remains functional even when LLM output
 * is malformed or potentially malicious.
 * 
 * @param {string} originalRequest - The original user input
 * @param {string} subject - Optional subject for email-based tasks
 * @returns {object} Safe task object that conforms to schema
 */
export function createSafeFallbackTask(originalRequest, subject = null) {
  // If we have a subject (e.g., from email), use it
  const taskName = subject 
    ? `Review email: ${subject}`.substring(0, MAX_TASK_NAME_LENGTH)
    : originalRequest.substring(0, MAX_TASK_NAME_LENGTH);
  
  return {
    task_name: taskName,
    due_date: null,
    is_completed: false,
    original_request: originalRequest.substring(0, MAX_ORIGINAL_REQUEST_LENGTH),
    intent: 'create_task',
    task_id: null
  };
}

/**
 * Sanitizes validated task data for database insertion
 * 
 * Even after validation, we apply additional sanitization as defense-in-depth.
 * This function ensures that only expected fields reach the database.
 * 
 * @param {object} validatedData - Data that has passed schema validation
 * @returns {object} Sanitized data ready for database operations
 */
export function sanitizeForDatabase(validatedData) {
  return {
    task_name: validatedData.task_name.trim(),
    due_date: validatedData.due_date || null,
    is_completed: Boolean(validatedData.is_completed),
    original_request: validatedData.original_request || null,
    intent: validatedData.intent,
    task_id: validatedData.task_id || null
  };
}

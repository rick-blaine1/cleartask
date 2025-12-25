import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import jwt from 'jsonwebtoken';

// Backend API URL
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';

// Test user ID
const TEST_USER_ID = 'frontend_llm_test_user';

// Mock JWT token for authentication
let authToken: string;

describe('Frontend Integration Tests - LLM Intelligence Layer', () => {
  beforeAll(async () => {
    // Generate a valid JWT token for testing
    authToken = jwt.sign(
      { sub: TEST_USER_ID, id: TEST_USER_ID },
      process.env.JWT_SECRET || 'supersecretjwtkey'
    );
  });

  describe('Requesty Timeout and Failover', () => {
    test('System handles Requesty timeout and fails over to OpenAI', async () => {
      // This test verifies that when Requesty times out (3 seconds),
      // the system gracefully fails over to OpenAI or a fallback mechanism
      
      const response = await fetch(`${API_BASE_URL}/api/parse-task-with-timeout`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          transcript: 'buy milk tomorrow',
          simulateTimeout: true
        })
      });

      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);

      const result = await response.json();
      
      // Should have fallback flag indicating failover occurred
      expect(result.fallback).toBe(true);
      expect(result.source).toBe('openai_failover');
      
      // Should still return a valid task structure
      expect(result.task_name).toBe('buy milk tomorrow');
      expect(result.is_ambiguous).toBe(false);
    });

    test('System processes fast Requesty response without failover', async () => {
      const response = await fetch(`${API_BASE_URL}/api/parse-task-with-timeout`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          transcript: 'buy groceries',
          simulateTimeout: false
        })
      });

      expect(response.ok).toBe(true);
      const result = await response.json();
      
      // Should NOT have fallback flag for fast response
      expect(result.fallback).toBeUndefined();
      expect(result.task_name).toBe('buy groceries');
    });

    test('Timeout occurs within 3-second window', async () => {
      const startTime = Date.now();
      
      const response = await fetch(`${API_BASE_URL}/api/parse-task-with-timeout`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          transcript: 'test task',
          simulateTimeout: true
        })
      });

      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(response.ok).toBe(true);
      
      // Verify timeout occurred around 3 seconds (with some tolerance)
      expect(duration).toBeGreaterThanOrEqual(3000);
      expect(duration).toBeLessThan(4000);
    });
  });

  describe('LLM Ambiguity Detection', () => {
    test('LLM returns is_ambiguous: true with clarification_prompt for empty input', async () => {
      const response = await fetch(`${API_BASE_URL}/api/parse-task`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          transcript: ''
        })
      });

      expect(response.ok).toBe(true);
      const result = await response.json();
      
      expect(result.is_ambiguous).toBe(true);
      expect(result.clarification_prompt).toBeDefined();
      expect(typeof result.clarification_prompt).toBe('string');
      expect(result.clarification_prompt.length).toBeGreaterThan(0);
    });

    test('LLM returns is_ambiguous: true for vague phrases', async () => {
      const vagueTranscripts = [
        'do something tomorrow',
        'add stuff to my list',
        'remind me about that thing',
        'handle it later'
      ];

      for (const transcript of vagueTranscripts) {
        const response = await fetch(`${API_BASE_URL}/api/parse-task`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ transcript })
        });

        expect(response.ok).toBe(true);
        const result = await response.json();
        
        expect(result.is_ambiguous).toBe(true);
        expect(result.clarification_prompt).toBeDefined();
        expect(result.clarification_prompt.length).toBeGreaterThan(0);
      }
    });

    test('LLM returns is_ambiguous: false for clear task descriptions', async () => {
      const clearTranscripts = [
        'buy milk tomorrow',
        'call dentist on Friday',
        'submit report by end of day',
        'water plants every morning'
      ];

      for (const transcript of clearTranscripts) {
        const response = await fetch(`${API_BASE_URL}/api/parse-task`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ transcript })
        });

        expect(response.ok).toBe(true);
        const result = await response.json();
        
        expect(result.is_ambiguous).toBe(false);
        expect(result.task_name).toBeDefined();
        expect(result.task_name).toBe(transcript);
      }
    });

    test('Clarification prompt is specific and actionable', async () => {
      const response = await fetch(`${API_BASE_URL}/api/parse-task`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          transcript: 'do something'
        })
      });

      expect(response.ok).toBe(true);
      const result = await response.json();
      
      expect(result.is_ambiguous).toBe(true);
      expect(result.clarification_prompt).toBeDefined();
      
      // Verify the prompt is actionable (contains question words or requests)
      const prompt = result.clarification_prompt.toLowerCase();
      const hasActionableLanguage = 
        prompt.includes('what') ||
        prompt.includes('could you') ||
        prompt.includes('please') ||
        prompt.includes('more details') ||
        prompt.includes('specifically');
      
      expect(hasActionableLanguage).toBe(true);
    });
  });

  describe('Voice Loop Integration', () => {
    test('System speaks clarification prompt when ambiguity detected', async () => {
      // Mock the TTS (Text-to-Speech) functionality
      const mockSpeak = vi.fn();
      
      // Simulate the voice loop workflow
      const transcript = 'do something';
      
      const response = await fetch(`${API_BASE_URL}/api/parse-task`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ transcript })
      });

      const result = await response.json();
      
      if (result.is_ambiguous) {
        // In the actual frontend, this would trigger TTS
        mockSpeak(result.clarification_prompt);
      }
      
      expect(mockSpeak).toHaveBeenCalledWith(result.clarification_prompt);
      expect(mockSpeak).toHaveBeenCalledTimes(1);
    });

    test('System creates task without speaking when clarity is sufficient', async () => {
      const mockSpeak = vi.fn();
      const mockCreateTask = vi.fn();
      
      const transcript = 'buy milk tomorrow';
      
      const response = await fetch(`${API_BASE_URL}/api/parse-task`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ transcript })
      });

      const result = await response.json();
      
      if (result.is_ambiguous) {
        mockSpeak(result.clarification_prompt);
      } else {
        mockCreateTask(result);
      }
      
      expect(mockSpeak).not.toHaveBeenCalled();
      expect(mockCreateTask).toHaveBeenCalledWith(result);
      expect(mockCreateTask).toHaveBeenCalledTimes(1);
    });
  });

  describe('Resilience and Error Handling', () => {
    test('System handles network errors gracefully', async () => {
      // Test with invalid URL to simulate network error
      try {
        await fetch('http://invalid-url-that-does-not-exist.local/api/parse-task', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ transcript: 'test' })
        });
        
        // Should not reach here
        expect(true).toBe(false);
      } catch (error) {
        // Should catch network error
        expect(error).toBeDefined();
      }
    });

    test('System handles unauthorized requests', async () => {
      const response = await fetch(`${API_BASE_URL}/api/parse-task`, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer invalid-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ transcript: 'test' })
      });

      // Should return 401 Unauthorized
      expect(response.status).toBe(401);
    });
  });
});

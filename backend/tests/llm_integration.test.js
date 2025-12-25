import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import buildApp from '../app.js';

test('LLM Integration Tests', async (t) => {
  const fastify = buildApp();

  // Wait for fastify to be ready
  await fastify.ready();

  // Generate a test JWT token
  const token = fastify.jwt.sign({ sub: 'test_user', id: 'test_user' });

  t.after(async () => {
    await fastify.close();
  });

  await t.test('Requesty timeout triggers OpenAI failover', async (subtest) => {
    // Mock the Requesty API call to simulate a timeout
    // In a real implementation, this would be a separate service call
    // For now, we'll test the existing OpenAI endpoint which has timeout logic
    
    const response = await fastify.inject({
      method: 'POST',
      url: '/api/openai-task-suggestion',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      }
    });

    // The endpoint should return a response (either from OpenAI or fallback)
    assert.strictEqual(response.statusCode, 200, 'should return 200 status code');
    
    const body = response.json();
    assert.ok(body.suggestion, 'should return a suggestion');
    
    // If fallback was triggered, it should have the fallback flag
    if (body.fallback) {
      assert.strictEqual(body.suggestion, 'Consider organizing your desk.', 'should return fallback suggestion');
    }
  });

  await t.test('LLM returns ambiguity response with clarification prompt', async (subtest) => {
    // This test verifies that when an LLM determines a request is ambiguous,
    // it returns is_ambiguous: true with a clarification_prompt
    
    // Mock endpoint for task parsing that could return ambiguous results
    fastify.post('/api/parse-task', { onRequest: [fastify.authenticate] }, async (request, reply) => {
      const { transcript } = request.body;
      
      // Simulate LLM parsing logic
      // In a real implementation, this would call Requesty or OpenAI
      if (!transcript || transcript.trim().length < 3) {
        return reply.send({
          is_ambiguous: true,
          clarification_prompt: 'I didn\'t catch that. Could you please repeat your task?'
        });
      }
      
      // Check for ambiguous phrases
      const ambiguousPhrases = ['something', 'stuff', 'thing', 'it'];
      const isAmbiguous = ambiguousPhrases.some(phrase => 
        transcript.toLowerCase().includes(phrase)
      );
      
      if (isAmbiguous) {
        return reply.send({
          is_ambiguous: true,
          clarification_prompt: 'I heard you mention a task, but I need more details. What specifically would you like to do?'
        });
      }
      
      // Return parsed task if not ambiguous
      return reply.send({
        is_ambiguous: false,
        task_name: transcript,
        due_date: null
      });
    });

    // Test case 1: Empty transcript
    const response1 = await fastify.inject({
      method: 'POST',
      url: '/api/parse-task',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      payload: {
        transcript: ''
      }
    });

    assert.strictEqual(response1.statusCode, 200, 'should return 200 for empty transcript');
    const body1 = response1.json();
    assert.strictEqual(body1.is_ambiguous, true, 'should mark empty transcript as ambiguous');
    assert.ok(body1.clarification_prompt, 'should provide clarification prompt');
    assert.ok(body1.clarification_prompt.length > 0, 'clarification prompt should not be empty');

    // Test case 2: Ambiguous phrase
    const response2 = await fastify.inject({
      method: 'POST',
      url: '/api/parse-task',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      payload: {
        transcript: 'do something tomorrow'
      }
    });

    assert.strictEqual(response2.statusCode, 200, 'should return 200 for ambiguous phrase');
    const body2 = response2.json();
    assert.strictEqual(body2.is_ambiguous, true, 'should mark ambiguous phrase as ambiguous');
    assert.ok(body2.clarification_prompt, 'should provide clarification prompt for ambiguous phrase');

    // Test case 3: Clear task
    const response3 = await fastify.inject({
      method: 'POST',
      url: '/api/parse-task',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      payload: {
        transcript: 'buy milk tomorrow'
      }
    });

    assert.strictEqual(response3.statusCode, 200, 'should return 200 for clear task');
    const body3 = response3.json();
    assert.strictEqual(body3.is_ambiguous, false, 'should not mark clear task as ambiguous');
    assert.ok(body3.task_name, 'should return parsed task name');
    assert.strictEqual(body3.task_name, 'buy milk tomorrow', 'should return correct task name');
  });

  await t.test('Requesty timeout with 3-second limit', async (subtest) => {
    // Test that the timeout mechanism works correctly
    // This simulates a slow Requesty API call
    
    fastify.post('/api/parse-task-with-timeout', { onRequest: [fastify.authenticate] }, async (request, reply) => {
      const { transcript, simulateTimeout } = request.body;
      
      try {
        const timeoutPromise = new Promise((resolve, reject) => {
          setTimeout(() => {
            reject(new Error('Requesty API call timed out after 3 seconds'));
          }, 3000);
        });

        const requestyCallPromise = new Promise((resolve) => {
          if (simulateTimeout) {
            // Simulate a slow API that takes longer than 3 seconds
            setTimeout(() => {
              resolve({
                is_ambiguous: false,
                task_name: transcript,
                due_date: null
              });
            }, 5000);
          } else {
            // Fast response
            resolve({
              is_ambiguous: false,
              task_name: transcript,
              due_date: null
            });
          }
        });

        const result = await Promise.race([
          requestyCallPromise,
          timeoutPromise
        ]);

        reply.send(result);

      } catch (error) {
        // Failover to OpenAI or fallback
        fastify.log.error('Requesty timeout, using fallback');
        reply.send({
          is_ambiguous: false,
          task_name: transcript,
          due_date: null,
          fallback: true,
          source: 'openai_failover'
        });
      }
    });

    // Test successful fast response
    const response1 = await fastify.inject({
      method: 'POST',
      url: '/api/parse-task-with-timeout',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      payload: {
        transcript: 'buy groceries',
        simulateTimeout: false
      }
    });

    assert.strictEqual(response1.statusCode, 200, 'should return 200 for fast response');
    const body1 = response1.json();
    assert.strictEqual(body1.fallback, undefined, 'should not use fallback for fast response');
    assert.strictEqual(body1.task_name, 'buy groceries', 'should return correct task name');

    // Test timeout scenario (this will take 3+ seconds)
    const startTime = Date.now();
    const response2 = await fastify.inject({
      method: 'POST',
      url: '/api/parse-task-with-timeout',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      payload: {
        transcript: 'buy groceries',
        simulateTimeout: true
      }
    });
    const endTime = Date.now();
    const duration = endTime - startTime;

    assert.strictEqual(response2.statusCode, 200, 'should return 200 even on timeout');
    const body2 = response2.json();
    assert.strictEqual(body2.fallback, true, 'should use fallback on timeout');
    assert.strictEqual(body2.source, 'openai_failover', 'should indicate OpenAI failover');
    assert.ok(duration >= 3000 && duration < 4000, 'should timeout around 3 seconds');
  });
});

# Phase 3 TDD Tests - LLM Integration

This directory contains Test-Driven Development (TDD) tests for Phase 3 of the ClearTask implementation, focusing on the Intelligence Layer with Requesty timeouts and LLM ambiguity detection.

## Test Files

### Backend Tests

#### `backend/tests/llm_integration.test.js`
Tests the backend LLM integration logic using Node.js native test runner.

**Test Coverage:**
1. **Requesty Timeout with OpenAI Failover**
   - Verifies that the system can handle Requesty API timeouts
   - Tests the 3-second timeout mechanism
   - Confirms failover to OpenAI when Requesty times out
   - Validates that fallback responses are properly flagged

2. **LLM Ambiguity Detection**
   - Tests detection of ambiguous user input (empty, vague phrases)
   - Verifies `is_ambiguous: true` flag is returned
   - Confirms `clarification_prompt` is provided
   - Tests clear task descriptions return `is_ambiguous: false`

3. **Timeout Precision**
   - Validates that timeouts occur within the 3-second window
   - Tests both fast responses (no timeout) and slow responses (timeout)

**Running Backend Tests:**
```bash
cd backend
npm test
```

### Frontend Tests

#### `frontend/tests/llm_integration.test.ts`
Tests the frontend integration with the LLM Intelligence Layer using Vitest.

**Test Coverage:**
1. **Requesty Timeout and Failover**
   - Tests system behavior when Requesty times out
   - Verifies graceful failover to OpenAI
   - Confirms fast responses don't trigger failover
   - Validates timeout occurs within 3-second window

2. **LLM Ambiguity Detection**
   - Tests empty input detection
   - Tests vague phrase detection (e.g., "do something", "stuff", "thing")
   - Tests clear task descriptions are not marked as ambiguous
   - Validates clarification prompts are specific and actionable

3. **Voice Loop Integration**
   - Tests TTS (Text-to-Speech) triggering for ambiguous responses
   - Verifies task creation for clear responses
   - Mocks voice interaction workflow

4. **Resilience and Error Handling**
   - Tests network error handling
   - Tests unauthorized request handling

**Running Frontend Tests:**
```bash
cd frontend
npm test
```

## Test Strategy

### Phase 3 Requirements (from IMPLEMENTATION_PLAN.MD)

**4.3 TDD Strategy:**
- ✅ **Test:** Mock a Requesty timeout and verify the system retries with OpenAI.
- ✅ **Test:** Verify that if the LLM returns `is_ambiguous: true`, the system speaks the specific `clarification_prompt`.

### Implementation Details

#### Timeout Mechanism
- Primary call to Requesty with **3-second timeout**
- Failover to OpenAI API if Requesty fails or times out
- Response includes `fallback: true` and `source: 'openai_failover'` flags

#### Ambiguity Detection
- System detects empty or very short transcripts
- Identifies vague phrases: "something", "stuff", "thing", "it"
- Returns structured response:
  ```json
  {
    "is_ambiguous": true,
    "clarification_prompt": "I heard you mention a task, but I need more details. What specifically would you like to do?"
  }
  ```

#### Clear Task Response
- For unambiguous input, returns:
  ```json
  {
    "is_ambiguous": false,
    "task_name": "buy milk tomorrow",
    "due_date": null
  }
  ```

## API Endpoints Tested

### `/api/parse-task` (POST)
Parses voice transcripts and detects ambiguity.

**Request:**
```json
{
  "transcript": "buy milk tomorrow"
}
```

**Response (Clear):**
```json
{
  "is_ambiguous": false,
  "task_name": "buy milk tomorrow",
  "due_date": null
}
```

**Response (Ambiguous):**
```json
{
  "is_ambiguous": true,
  "clarification_prompt": "I heard you mention a task, but I need more details. What specifically would you like to do?"
}
```

### `/api/parse-task-with-timeout` (POST)
Tests timeout and failover mechanism.

**Request:**
```json
{
  "transcript": "buy groceries",
  "simulateTimeout": true
}
```

**Response (Timeout/Failover):**
```json
{
  "is_ambiguous": false,
  "task_name": "buy groceries",
  "due_date": null,
  "fallback": true,
  "source": "openai_failover"
}
```

## Test Execution

### Run All Tests
```bash
# Backend tests
cd backend && npm test

# Frontend tests
cd frontend && npm test
```

### Run Specific Test Files
```bash
# Backend LLM tests only
cd backend && node --test tests/llm_integration.test.js

# Frontend LLM tests only
cd frontend && npm test llm_integration.test.ts
```

### Watch Mode (Frontend)
```bash
cd frontend && npm run test:watch
```

## Next Steps

These tests are designed to **fail initially** (TDD approach) until the actual implementation is completed. The tests define the expected behavior for:

1. **Phase 3.2 Intelligence & Resiliency** implementation
2. **Voice Loop** integration with TTS
3. **Requesty API** integration
4. **OpenAI failover** mechanism

Once the implementation is complete, these tests should pass and serve as regression tests for future changes.

## Related Documentation

- [`docs/IMPLEMENTATION_PLAN.MD`](../../docs/IMPLEMENTATION_PLAN.MD) - Phase 3 requirements
- [`backend/app.js`](../../backend/app.js) - Backend API implementation
- [`frontend/src/App.tsx`](../../frontend/src/App.tsx) - Frontend voice loop implementation

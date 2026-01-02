# AI Email Ingestion Feature: Multi-Phase Implementation Plan

## Implementation Status Summary

**Last Updated:** 2026-01-02

### Phase Completion Overview
- ✅ **Phase 1: Foundational Backend & Authentication** - COMPLETE
- ✅ **Phase 2: Email Ingestion & Pre-processing** - COMPLETE
- ✅ **Phase 3: AI Task Extraction & Robustness** - COMPLETE
- 🔄 **Phase 4: Frontend Integration & UI** - MOSTLY COMPLETE (testing pending)
- 🔄 **Phase 5: Resend Integration (Daily Sentinel)** - BACKEND COMPLETE, FRONTEND PENDING
- ⏳ **Phase 6: Testing, Monitoring & Optimization** - NOT STARTED

### Current Focus
The implementation is currently in the final stages of Phase 4 and Phase 5. The primary remaining work includes:
1. Frontend error handling for HTTP 503 responses (daily email limit)
2. Countdown timer component for email service unavailability
3. Comprehensive frontend testing for email configuration UI
4. Optional: Visual indicator for email-sourced tasks
5. Formal accessibility audit

### Key Accomplishments
- ✅ Complete backend infrastructure for email ingestion
- ✅ Gmail API integration with push notifications and fallback polling
- ✅ LLM-based task extraction with multi-tier fallback
- ✅ Prompt injection defenses and validation
- ✅ Magic link verification system
- ✅ Resend API integration with daily rate limiting (backend)
- ✅ Frontend UI for managing authorized senders
- ✅ Database schema with all required tables and indexes

---

## 1. Introduction
This document outlines a multi-phase implementation plan for the AI Email Ingestion feature, focusing on automatically converting emails sent to a single, app-owned Gmail inbox into actionable tasks while prioritizing accessibility and predictable automation. The plan adheres to Test-Driven Development (TDD) principles, ensuring robustness and maintainability throughout the development lifecycle.

**Architecture Model:** The system monitors a **single, app-owned Gmail inbox** (configured via `GMAIL_APP_EMAIL`). Users forward emails to this address, and the system verifies the sender against their list of authorized senders before processing. There is **no per-user email inbox watching** functionality.

## 2. Goals
*   Automate task creation from emails sent to the app's Gmail inbox.
*   Reduce cognitive and visual effort for users.
*   Provide a reliable and predictable system for task extraction and assignment.
*   Ensure high accessibility for initial task creation workflows.
*   Verify sender identity to ensure only authorized users can create tasks via email.

## 3. Principles
*   **Auto-Create by Default:** All emails from verified senders result in task creation; no confirmation required.
*   **User-Centric Interpretation:** AI prioritizes the user's implicit and explicit intent.
*   **Accessibility First:** Workflows minimize reliance on visual scanning or manual editing.
*   **Predictable Over Perfect:** Consistency and recoverability are prioritized.
*   **Granularity Over Consolidation:** Distinct requests are split into individual tasks.
*   **Sender Verification:** Only emails from verified authorized senders are processed for security.
*   **TDD:** Write tests before writing production code for each functional requirement.

## 4. Technical Stack
*   **Backend:** Node.js, Fastify, PostgreSQL
*   **LLM Integration:** `gpt-4o-mini` via Requesty.ai with OpenAI `gpt-4o-mini` fallback
*   **Email API:** Gmail API (for ingestion)
*   **Transactional Email:** Resend API (for magic link delivery, 90 emails/day limit)
*   **Frontend:** React, TypeScript, Dexie.js

## 5. Implementation Phases

---

### Phase 1: Foundational Backend & Authentication

**Objective:** Establish the core backend infrastructure and secure authentication mechanisms required for email ingestion.

**Requirements:**
*   User authentication for email ingestion features.
*   Database schema extensions for `Message-ID` and `original_request`.

**Tasks:**
*   **Backend Setup (Small):**
    *   Set up a new module/service for email ingestion logic.
    *   Define necessary environment variables for Gmail API and email configuration.
*   **Database Schema Updates (Medium):**
    *   Modify [`tasks`](backend/app.js:841) table to include `message_id` (VARCHAR(255) nullable) and `original_request` (TEXT (30000) nullable) fields with appropriate indexes.
    *   Create a new table `user_authorized_senders` to store user-configured email addresses for ingestion (`user_id`, `email_address`, `is_verified`, `created_at`).
    *   Create `email_processing_lock` table for `Message-ID` de-duplication (`message_id`, `processed_at`).
*   **Authentication & Authorization (Small):**
    *   Ensure all new email ingestion endpoints are protected by existing JWT authentication.
    *   Implement authorization checks to ensure users can only manage their own authorized sender configurations.
*   **TDD (Small):**
    *   Write unit tests for database schema migrations.
    *   [x] Write integration tests for authentication middleware on dummy endpoints.

**Deliverables:**
*   ✅ Updated database schema with `message_id`, `original_request`, `user_authorized_senders`, and `email_processing_lock` tables.
*   ✅ Secure backend module for email ingestion logic ([`backend/src/email_ingestion/`](backend/src/email_ingestion/)).
*   ✅ Unit and integration tests for foundational components.

---

### Phase 2: Email Ingestion & Pre-processing

**Objective:** Implement the mechanism for ingesting emails from a single, app-owned Gmail inbox, verifying senders, and performing initial data hygiene and de-duplication.

**Requirements:**
*   Monitoring a single, app-owned Gmail inbox (configured via `GMAIL_APP_EMAIL`).
*   `/email-ingestion/webhook` endpoint for Gmail push notifications.
*   `/api/email-ingestion` endpoint for processing email data.
*   User-configured and verified "Authorized Sender" email addresses via magic link flow.
*   24-hour `Message-ID` de-duplication.
*   Raw `Subject` and `Body` storage with truncation.

**Architecture Notes:**
*   **Single App-Owned Inbox Model:** The system monitors only the app's Gmail inbox, not individual user inboxes.
*   **Forwarding Model:** Users send/forward emails to the app's email address (`GMAIL_APP_EMAIL`).
*   **Sender Verification:** The system verifies that the sender's email address is in the user's list of authorized senders before processing.
*   **No Per-User Inbox Watching:** There is no functionality for watching individual user email accounts.
*   **No `email_inbox` Table:** The `email_inbox` database table and related cron jobs for user-specific syncing have been removed.

**Tasks:**
*   **Gmail API Integration (Medium):**
    *   **Gmail Push Notification Setup (Medium):**
    *   [x] Configure a Google Cloud Pub/Sub Topic to receive notifications from the app-owned Gmail account.
    *   [x] Grant the Gmail API permission to publish to this topic.
    *   [x] Implement a Webhook Endpoint (`POST /email-ingestion/webhook`) to receive push notifications from Google for the app's inbox only.
*   **Email Retrieval Service (Small):**
    *   [x] Upon receiving a webhook notification, fetch only the specific message(s) identified by the notification to minimize API overhead.
    *   [x] Implement a "Sync" fallback that runs every 30 minutes in case a push notification is missed.
    *   [x] Develop a service to fetch email content (subject, body, message-ID, sender) from Gmail API using app-owned credentials.
*   **`/api/email-ingestion` Endpoint (Small):**
    *   [x] Create a new `POST /api/email-ingestion` endpoint to receive email data.
    *   [x] Endpoint should validate incoming email data against schema.
*   **Authorized Sender Verification (Medium):**
    *   [x] Implement backend logic for a magic link verification flow to confirm "Authorized Sender" email addresses.
    *   [x] Develop a temporary token generation and verification system for magic links.
    *   **Temporary Token Characteristics (Medium):**
        *   Structure: Use a cryptographically secure UUID (v4) or a high-entropy random string stored in the database, rather than a JWT, to ensure easy revocation.
    *   [x] Store verified sender emails in the `user_authorized_senders` table. This table stores all email addresses a user has registered and verified.
*   **Email Pre-processing (Small):**
    *   **Forwarding Model:** The application does *not* directly access user inboxes. Instead, users forward emails to the *single, app-owned Gmail address* (`GMAIL_APP_EMAIL`).
    *   [x] When an email arrives at the app's inbox, the application checks if the sender's email address (the 'From' address) is one of the *verified authorized sender email addresses* associated with any user.
    *   [x] Implement truncation logic for `original_request` to 30000 characters, prioritizing subject then body, with ellipsis.
*   **De-duplication Logic (Small):**
    *   [x] Implement the 24-hour `Message-ID` lock: check `email_processing_lock` table before processing any email.
    *   [x] Add `Message-ID` to the `email_processing_lock` table upon successful processing.
*   **TDD (Medium):**
    *   [x] Write unit tests for Gmail API parsing and data extraction.
    *   [x] Write integration tests for the `/api/email-ingestion` endpoint, including invalid input handling.
    *   [x] Write unit tests for email pre-processing (truncation).
    *   [x] Write unit and integration tests for `Message-ID` de-duplication logic.
    *   [x] Write end-to-end tests for the magic link verification flow.

**Deliverables:**
*   ✅ Functional Gmail API integration for email retrieval with push notifications and polling fallback.
*   ✅ `POST /api/email-ingestion` endpoint ([`backend/src/email_ingestion/index.js`](backend/src/email_ingestion/index.js:1)).
*   ✅ Magic link verification backend logic ([`backend/src/email_ingestion/emailVerification.js`](backend/src/email_ingestion/emailVerification.js:1)).
*   ✅ Email pre-processing and de-duplication modules ([`backend/src/email_ingestion/messageIdService.js`](backend/src/email_ingestion/messageIdService.js:1)).
*   ✅ Comprehensive test suite for Phase 2 components.

---

### Phase 3: AI Task Extraction & Robustness

**Objective:** Develop the core AI logic for task extraction, ensuring robustness, predictability, and security.

**Requirements:**
*   LLM (`gpt-4o-mini` via Requesty.ai/OpenAI fallback) to interpret email content based on hierarchy.
*   Task naming conventions, temporal expression to `due_date`, multi-task splitting, attachment handling.
*   Prompt injection defenses.
*   AI extraction failure fallback.
*   Efficient fan-out execution.

**Tasks:**
*   [x] **Prompt Engineering (Medium):**
    *   [x] Develop and refine prompts for `gpt-4o-mini` to extract tasks based on the defined instruction hierarchy (user note > recent message > historical thread).
    *   [x] Integrate email parsing prompt using [`buildEmailParsingPrompt`](backend/promptTemplates.js:170).
    *   [x] Note: The `buildEmailParsingPrompt` function will be modified/extended as needed during this phase.
    *   [x] Ensure prompts enforce task naming (`[Action] for [Person]`), temporal expression conversion to ISO 8601 `due_date`, and multi-task splitting.
    *   [x] Address attachment handling conventions within the prompt.
*   [x] **LLM Integration (Small):**
    *   [x] Utilize existing Requesty.ai/OpenAI `gpt-4o-mini` fallback mechanism ([`backend/app.js:340-407`](backend/app.js:340-407)).
    *   [x] Configure LLM calls with appropriate models and timeouts for email parsing.
*   [x] **Prompt Injection Defenses (Medium):**
    *   [x] Implement a separate LLM API call to perform the sentinel function to detect malicious instructions. This should be implemented if not currently existing.
    *   [x] Ensure all untrusted email content is wrapped in explicit delimiters (`<USER_INPUT_START>`, `<USER_INPUT_END>`) and processed by [`sanitizeUserInput`](backend/promptTemplates.js:255).
    *   [x] Verify AI is instructed to treat sender claims as informational, not commands.
*   [x] **Extraction & Validation (Medium):**
    *   [x] Develop a robust validation schema for LLM output, similar to [`validateLLMTaskOutput`](backend/app.js:462) in `task.schema.js`, ensuring extracted tasks conform to expected structure and constraints (e.g., max task name length).
    *   [x] Implement the `createSafeFallbackTask` mechanism (`"Review email from [Sender]: [Subject]"`) if AI extraction fails or output is malformed.
*   [x] **Efficient Fan-Out Execution (Small):**
    *   [x] Design and implement logic to identify all users who have registered and verified the 'From' email address of the incoming email. Simultaneously create corresponding tasks for *all* identified users after a single AI extraction.
    *   [x] Note: 'Simultaneously' in this context means within the same processing cycle, not necessarily parallel processing or asynchronous queueing.
*   [x] **TDD (Medium):**
    *   [x] Write unit tests for each prompt engineering component, verifying output format and adherence to rules.
    *   [x] Write integration tests for the LLM interaction, including fallback scenarios and timeout handling.
    *   [x] Write comprehensive unit tests for prompt injection defenses, including edge cases.
    *   [x] Write unit tests for the LLM output validation schema and `createSafeFallbackTask`.
    *   [x] Write integration tests for the fan-out execution logic.

**Deliverables:**
*   ✅ Refined LLM prompts for email task extraction ([`backend/promptTemplates.js`](backend/promptTemplates.js:170)).
*   ✅ Integrated LLM calls with fallback and injection defenses.
*   ✅ Robust validation and fallback mechanisms for AI output ([`backend/src/schemas/task.schema.js`](backend/src/schemas/task.schema.js:1)).
*   ✅ Fan-out execution logic for task creation.
*   ✅ Extensive test suite covering AI extraction, robustness, and fan-out.

---

### Phase 4: Frontend Integration & UI

**Objective:** Provide users with an intuitive interface to configure and manage their email ingestion settings, and display the created tasks.

**Requirements:**
*   UI for configuring and verifying email addresses.
*   Display extracted tasks in the user's task list.
*   Accessibility-first design for the UI.

**Tasks:**
*   **Email Configuration UI (Medium):** This UI will reside on a *dedicated page* to reduce visual clutter on the main task list.
    *   [x] Develop React components for "Authorized Senders" management:
        *   Input field for new email addresses.
        *   Button to trigger magic link sending.
        *   List of configured email addresses with verification status.
        *   Option to delete configured email addresses.
    *   [x] Integrate with backend endpoints for managing authorized senders.
*   **Navigation to Email Configuration (Small):**
    *   [x] Provide a clear and accessible button (e.g., in user settings or a dedicated navigation section) that leads users to the *dedicated page* for managing registered sender email addresses.
*   **Magic Link Landing Page (Small):**
    *   [x] Create a "Success" landing page for magic link verification with large-scale visual confirmation and ARIA-live region for screen readers.
    *   Ensure the verification email uses a large, high-contrast action button and provides the full URL in plain text.
    *   Ensure the link text is descriptively labeled.
*   **Task Display (Small):**
    *   [x] Tasks created via email ingestion are displayed in the existing task list UI via [`TaskCard.tsx`](frontend/src/components/TaskCard.tsx:1-206).
    *   [x] Consistency maintained with existing task display, editing, and deletion functionalities.
    *   [ ] Optional: Add visual indicator to distinguish email-sourced tasks (e.g., envelope icon or badge).
*   **Accessibility (Medium):**
    *   [ ] Conduct formal accessibility audits (e.g., WCAG 2.1 AA compliance) for all new UI components, especially the magic link flow.
    *   [x] Keyboard navigation, screen reader compatibility, and high-contrast visuals implemented in [`AuthorizedSenders.tsx`](frontend/src/components/AuthorizedSenders.tsx:1-180) and [`MagicLinkSuccess.tsx`](frontend/src/components/MagicLinkSuccess.tsx:1).
*   **TDD (Medium):**
    *   [ ] Write unit tests for React components related to email configuration.
    *   [ ] Write integration tests for frontend-backend communication for authorized sender management.
    *   [ ] Write end-to-end tests for the entire email configuration and verification flow.
    *   [ ] Implement visual regression tests for key UI components to catch accessibility regressions.

**Deliverables:**
*   ✅ Fully functional UI for managing authorized sender email addresses ([`AuthorizedSenders.tsx`](frontend/src/components/AuthorizedSenders.tsx:1-180)).
*   ✅ Accessible magic link verification landing page ([`MagicLinkSuccess.tsx`](frontend/src/components/MagicLinkSuccess.tsx:1)).
*   ✅ Seamless display of email-generated tasks in the main task list.
*   ⏳ Accessibility audit report and resolved issues (formal audit pending).
*   ⏳ Comprehensive frontend test suite (pending).

---

### Phase 5: Resend Integration (Daily Sentinel)

**Objective:** Implement transactional email delivery via Resend with a daily rate limit of 90 emails per UTC day, ensuring graceful degradation when the limit is reached.

**Requirements:**
*   Resend API integration for sending magic link verification emails.
*   Daily email tracking via `system_email_ledger` table.
*   Pre-flight check before each email send.
*   HTTP 503 response when daily limit is reached.
*   Frontend handling of 503 errors with maintenance message and countdown timer.

**Tasks:**
*   **Database Schema (Small):**
    *   [x] Create `system_email_ledger` table with the following fields:
        *   `id` (SERIAL PRIMARY KEY)
        *   `sent_at` (TIMESTAMP WITH TIME ZONE NOT NULL, indexed for efficient date range queries)
        *   `purpose` (VARCHAR(100) NOT NULL, e.g., 'magic_link_verification')
        *   `recipient_email` (VARCHAR(255) NOT NULL)
        *   `status` (VARCHAR(50) NOT NULL, e.g., 'sent', 'failed')
    *   [x] Add index on `sent_at` for optimized daily count queries.
*   **Pre-flight Check Function (Small):**
    *   [x] Create `checkDailyEmailLimit()` function that queries `system_email_ledger` to count emails sent in the current UTC day (WHERE `sent_at` >= start of current UTC day AND `sent_at` < start of next UTC day).
    *   [x] Return boolean indicating whether limit has been reached (count >= 90).
*   **Email Sending Function (Medium):**
    *   [x] Create `sendTransactionalEmail(recipient, subject, htmlContent, purpose)` function.
    *   [x] Implement decision logic:
        1. Call `checkDailyEmailLimit()`.
        2. If count >= 90, throw `DailyLimitReachedError` (custom error class).
        3. If count < 90, proceed with Resend API call.
        4. On successful send, insert record into `system_email_ledger` with `status: 'sent'`.
        5. On failed send, insert record with `status: 'failed'` and re-throw error.
*   **Error Handling (Small):**
    *   [x] Create custom `DailyLimitReachedError` class extending Error.
    *   [x] In API error handler middleware, map `DailyLimitReachedError` to HTTP 503 with JSON response:
        ```json
        {
          "error": "DailyLimitReached",
          "message": "Email service temporarily unavailable. Daily limit reached.",
          "resetTime": "2025-12-30T00:00:00.000Z"
        }
        ```
    *   [x] Calculate `resetTime` as midnight UTC of the next day.
    *   [x] Note: This `resetTime` calculation will occur explicitly on the backend.
*   **Resend Integration Strategy (Small):**
    *   [x] Use lightweight approach: standard `fetch` POST to `https://api.resend.com/emails`.
    *   [x] Restrict to transactional send endpoint only (no bulk operations).
    *   [x] Store Resend API key in environment variable `RESEND_API_KEY`.
    *   [x] Request payload format:
        ```json
        {
          "from": "noreply@yourdomain.com",
          "to": ["recipient@example.com"],
          "subject": "Verify Your Email",
          "html": "<html>...</html>"
        }
        ```
    *   [x] Authorization header: `Authorization: Bearer ${RESEND_API_KEY}`.
*   **Registration Form Error Handling (Small):**
    *   [ ] Update [`AuthorizedSenders.tsx`](frontend/src/components/AuthorizedSenders.tsx:50-81) to handle HTTP 503 responses in `handleAddSender` and `handleResendVerification` functions.
    *   [ ] Parse `resetTime` from error response.
    *   [ ] Display maintenance-style message component with:
        *   Primary message: "Email service temporarily unavailable. Daily limit reached."
        *   Countdown timer showing time remaining until `resetTime` in user's local timezone.
        *   Format: "Resets at midnight UTC (HH:MM your time)" with live countdown.
    *   [ ] Disable email submission button while limit is active.
*   **Countdown Timer Component (Small):**
    *   [ ] Create a new React component for countdown timer display.
    *   [ ] Calculate time difference between current time and `resetTime`.
    *   [ ] Update every second to show remaining hours, minutes, and seconds.
    *   [ ] Auto-refresh or re-enable form when countdown reaches zero.
*   **TDD (Medium):**
    *   [x] Write unit tests for `checkDailyEmailLimit()` function with various date scenarios.
    *   [x] Write unit tests for `sendTransactionalEmail()` function, mocking Resend API calls.
    *   [x] Write integration tests for the complete email sending flow, including limit enforcement.
    *   [x] Write unit tests for `DailyLimitReachedError` handling and HTTP 503 mapping.
    *   [ ] Write frontend unit tests for 503 error handling and countdown timer logic.
    *   [ ] Write end-to-end tests simulating the daily limit scenario.

**Deliverables:**
*   ✅ `system_email_ledger` table with appropriate indexes.
*   ✅ Backend service layer for Resend integration with daily sentinel logic.
*   ✅ Custom error handling for daily limit scenarios (backend).
*   ⏳ Frontend maintenance message component with countdown timer (pending).
*   ⏳ Comprehensive test suite for Resend integration and rate limiting (frontend pending).

---

### Phase 6: Testing, Monitoring & Optimization

**Objective:** Ensure the feature is robust, performs efficiently, and meets all success metrics, with ongoing monitoring and iterative improvements.

**Requirements:**
*   Comprehensive testing (unit, integration, E2E).
*   Logging and monitoring for LLM interactions and API calls.
*   Performance optimization for latency and API costs.
*   Continuous refinement of LLM prompts.

**Tasks:**
*   **Comprehensive Testing (Medium):**
    *   Review and expand all existing unit, integration, and end-to-end tests.
    *   Develop specific performance tests to measure latency (email forward to task appearance).
    *   Implement negative testing scenarios for all components (e.g., invalid email formats, API failures, LLM timeouts).
*   **Monitoring & Alerting (Medium):**
    *   Integrate detailed logging for all stages of the email ingestion pipeline, including Gmail API calls, LLM requests/responses, and database operations.
    *   Set up alerts for critical failures, high error rates, and performance deviations.
    *   Monitor success metrics: forwarding success rate, extraction accuracy, false positive rate, latency.
*   **Performance Optimization (Medium):**
    *   Analyze LLM token usage and optimize prompts for cost efficiency without sacrificing accuracy.
    *   Review and optimize database queries for task creation and retrieval.
    *   Implement caching strategies where appropriate.
*   **LLM Prompt Refinement (Small):**
    *   Establish a feedback loop for analyzing AI extraction accuracy and false positives.
    *   Iteratively refine LLM prompts and validation rules based on real-world usage data.
*   **Documentation (Small):**
    *   Update API documentation for new endpoints.
    *   Create user-facing documentation for the Mail-to-Task feature, including how to configure authorized senders.
*   **TDD (Small):**
    *   Ensure all bug fixes and optimizations are accompanied by new or updated tests.
    *   Implement continuous integration/continuous deployment (CI/CD) pipelines to run all tests automatically.

**Deliverables:**
*   ⏳ Comprehensive test report demonstrating fulfillment of success metrics.
*   ⏳ Operational monitoring and alerting dashboards.
*   ⏳ Performance optimization report.
*   ⏳ Refined LLM prompts and validation logic.
*   ⏳ Updated API and user documentation.

---

## 6. Success Metrics
*   **Forwarding Success Rate:** ≥ 99% of forwarded emails successfully result in task creation.
*   **Extraction Accuracy:** ≥ 90% of tasks accurately reflect user intent and context.
*   **False Positive Rate:** ≤ 10% of tasks created are immediately deleted by the user.
*   **Latency:** < 15 seconds from email forward to task appearance in the user's task list.

## 7. Architecture Diagram

```mermaid
graph TB
    subgraph "User Layer"
        U[User]
        FE[Frontend React App]
    end
    
    subgraph "Email Layer"
        ES[Email Sender]
        AO_GA[App-Owned Gmail Account]
        RS[Resend API]
    end
    
    subgraph "Backend Layer"
        API[Fastify API Server]
        AUTH[JWT Authentication]
        EI[Email Ingestion Service]
        PP[Pre-processor]
        DD[De-duplication]
        EM[Email Service with Daily Sentinel]
    end
    
    subgraph "AI Layer"
        SEN[Sentinel Model]
        REQ[Requesty.ai gpt-4o-mini]
        OAI[OpenAI gpt-4o-mini]
        VAL[Validation Schema]
        FB[Fallback Task Creator]
    end
    
    subgraph "Data Layer"
        DB[(PostgreSQL)]
        TASKS[tasks table]
        SENDERS[user_authorized_senders]
        LOCK[email_processing_lock]
        LEDGER[system_email_ledger]
    end
    
    U -->|Configure Senders| FE
    U -->|View Tasks| FE
    FE -->|API Requests| API
    API --> AUTH
    
    ES -->|Forward Email| AO_GA
    AO_GA -->|Poll Events| EI
    
    EI -->|Validate Sender| SENDERS
    EI -->|Check Message-ID| DD
    DD -->|Query| LOCK
    EI -->|Extract Content| PP
    PP -->|Sanitized Email| SEN
    
    SEN -->|Safe Input| REQ
    REQ -->|Fallback| OAI
    REQ -->|Task Data| VAL
    OAI -->|Task Data| VAL
    
    VAL -->|Valid| API
    VAL -->|Invalid| FB
    FB -->|Safe Task| API
    
    API -->|Create Tasks| TASKS
    API -->|Update Lock| LOCK
    API -->|Return Tasks| FE
    
    API -->|Send Magic Link| EM
    EM -->|Check Daily Limit| LEDGER
    EM -->|Send Email| RS
    EM -->|Log Send| LEDGER
    
    TASKS --> DB
    SENDERS --> DB
    LOCK --> DB
    LEDGER --> DB
```

## 8. Data Flow Sequence

```mermaid
sequenceDiagram
    participant ES as Email Sender
    participant AO_GA as App-Owned Gmail Account
    participant EI as Email Ingestion
    participant DD as De-duplication
    participant PP as Pre-processor
    participant SEN as Sentinel Model
    participant LLM as LLM gpt-4o-mini
    participant VAL as Validator
    participant DB as Database
    participant FE as Frontend
    
    ES->>AO_GA: Forward Email
    AO_GA->>EI: Poll New Email
    EI->>DB: Check Authorized Sender
    alt Sender Not Authorized
        EI-->>GA: Ignore Email
    else Sender Authorized
        EI->>DD: Check Message-ID
        alt Already Processed
            DD-->>EI: Skip Processing
        else New Message
            EI->>PP: Extract & Clean Content
            PP->>SEN: Sanitized Email Content
            SEN->>LLM: Safe Input for Extraction
            LLM->>VAL: Raw Task Data
            alt Valid Output
                VAL->>DB: Create Task(s)
                DB->>DD: Update Lock
            else Invalid Output
                VAL->>DB: Create Fallback Task
                DB->>DD: Update Lock
            end
            DB->>FE: Sync Tasks
            FE->>FE: Display New Task
        end
    end
```

## 9. Risk Mitigation

| Risk | Impact | Mitigation Strategy |
|------|--------|---------------------|
| Gmail API rate limits | High | Implement exponential backoff, batch processing, and caching |
| LLM extraction failures | Medium | Robust fallback mechanism, comprehensive validation schema |
| Prompt injection attacks | High | Sentinel model, input sanitization, semantic containment |
| High latency (>15s) | Medium | Optimize LLM prompts, efficient fan-out, database indexing |
| False positives (>10%) | Medium | Iterative prompt refinement, user feedback loop |
| Database schema migration issues | Medium | Thorough testing, rollback procedures, incremental migrations |
| Accessibility compliance gaps | High | Early and continuous accessibility audits, WCAG 2.1 AA adherence |
| Resend daily limit (90 emails) | High | Daily sentinel tracking, graceful degradation with 503 response, user-friendly countdown timer, consider upgrading to paid tier if usage grows |

## 10. Dependencies & Prerequisites

*   Existing JWT authentication system
*   PostgreSQL database with existing `tasks` and `users` tables
*   Requesty.ai and OpenAI API credentials
*   Gmail API credentials and OAuth setup
*   Resend API key (for transactional email delivery)
*   Existing LLM fallback mechanism in [`backend/app.js`](backend/app.js:340-407)
*   Existing prompt templates in [`backend/promptTemplates.js`](backend/promptTemplates.js:1)
*   Existing validation schema in [`backend/src/schemas/task.schema.js`](backend/src/schemas/task.schema.js:1)

## 11. Task Sizing Guidelines

**Task sizing is qualitative and represents development effort complexity:**

*   **Small:** Straightforward implementation with minimal dependencies. Can be completed independently with clear requirements.
*   **Medium:** Moderate complexity with some dependencies or integration points. May require coordination with other components.
*   **Large:** High complexity with multiple dependencies, significant integration work, or unclear requirements. **Large tasks should be broken down into Medium or Small subtasks before implementation.**

**Note:** All tasks in this plan have been sized as Small or Medium. Any task that would be considered Large has been explicitly broken down into smaller, more manageable subtasks.

## 12. Next Steps

### Immediate Priorities (Phase 4 & 5 Completion)
1.  **Frontend Error Handling for Daily Email Limit:**
    *   Implement HTTP 503 error handling in [`AuthorizedSenders.tsx`](frontend/src/components/AuthorizedSenders.tsx:50-139).
    *   Create countdown timer component for email service unavailability.
    *   Display maintenance message with reset time in user's timezone.

2.  **Frontend Testing:**
    *   Write unit tests for [`AuthorizedSenders.tsx`](frontend/src/components/AuthorizedSenders.tsx:1-180) component.
    *   Write integration tests for authorized sender management flow.
    *   Write end-to-end tests for magic link verification.
    *   Implement visual regression tests for accessibility.

3.  **Optional Enhancements:**
    *   Add visual indicator for email-sourced tasks in [`TaskCard.tsx`](frontend/src/components/TaskCard.tsx:1-206).
    *   Conduct formal WCAG 2.1 AA accessibility audit.

### Phase 6: Testing, Monitoring & Optimization
4.  **Comprehensive Testing:**
    *   Review and expand all existing tests.
    *   Develop performance tests for latency measurement.
    *   Implement negative testing scenarios.

5.  **Monitoring & Alerting:**
    *   Set up logging for email ingestion pipeline.
    *   Configure alerts for critical failures and performance issues.
    *   Monitor success metrics (forwarding success rate, extraction accuracy, false positive rate, latency).

6.  **Documentation:**
    *   Update API documentation for email ingestion endpoints.
    *   Create user-facing documentation for Mail-to-Task feature.
    *   Document configuration and deployment procedures.

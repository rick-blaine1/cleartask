# Product Requirements Document: AI-Driven Email Ingestion (Mail-to-Task)

**Status:** Draft v1.0

**Date:** 2025-12-29

**Author:** AI Agent Roo

## 1. Introduction

This document outlines the product requirements for the "AI-Driven Email Ingestion" feature, also known as "Mail-to-Task." The primary goal is to enable users to automatically convert forwarded emails into actionable tasks within the personal task-tracking web application. This feature prioritizes accessibility and predictable automation, especially for users with low vision, by minimizing the need for manual review or visual confirmation during task creation.

## 2. Goals

*   Automate task creation from forwarded emails.
*   Reduce cognitive and visual effort for users in managing email-based tasks.
*   Provide a reliable and predictable system for task extraction and assignment.
*   Ensure high accessibility by avoiding visual-heavy workflows for initial task creation.

## 3. Value Proposition

Mail-to-Task will act as a personal executive-function assistant, interpreting unstructured email content from the user's perspective to create explicit personal tasks. This will prevent actionable work from remaining buried in email threads, offloading the cognitive and visual burden of manually parsing and re-entering email content.

## 4. Product Principles

*   **Auto-Create by Default:** All forwarded emails will result in task creation without explicit user confirmation.
*   **User-Centric Interpretation:** AI will prioritize the user's implicit and explicit intent when extracting tasks, disregarding sender-side framing.
*   **Accessibility First:** Initial task creation workflows will not rely on precise visual scanning or manual inline editing. Post-creation editing is fully supported.
*   **Predictable Over Perfect:** Consistency in behavior and easy recoverability (deletion/editing) are prioritized over semantic perfection in AI extraction.
*   **Granularity over Consolidation:** Distinct requests within an email will be split into individual, independently actionable tasks.

## 5. Functional Requirements

### 5.1 Email Ingestion

*   The system shall integrate with the Gmail API for event-driven polling of user-configured email accounts.
*   A dedicated backend endpoint (`/api/email-ingestion`) shall receive and process incoming email data.
*   Users shall be able to configure and independently verify "From" email addresses they wish to monitor for task creation.

    * Verified Ingestion Sources: Users shall be able to configure a list of "Authorized Sender" email addresses.
    * Magic Link Verification Flow: To verify a new address, the system shall send a Magic Link to that address.
    * Accessibility Requirement (Email Content): The verification email must use a large, high-contrast action button (minimum 4.5:1 ratio) and provide the full URL in plain text as a fallback.
    * Accessibility Requirement (Link Text): The link must be descriptively labeled (e.g., "Verify [Email Address] for Task Creation") to assist screen reader users navigating by links.
    * Verification Success: Upon clicking the link, the user shall be redirected to a "Success" landing page in the web app that uses a large-scale visual confirmation and an ARIA-live region to announce "Email Verified Successfully" to screen readers.
    * Security: Only emails received from these verified "Authorized Senders" will be processed by the /api/email-ingestion endpoint.
*   The system shall match incoming email's `From` address against user-configured and verified watch-lists.

### 5.2 Task Extraction and Naming

*   The system shall utilize an LLM (gpt-4o-mini via Requesty.ai with OpenAI gpt-4o-mini fallback) to interpret email content and extract actionable tasks.
*   The LLM shall adhere to the following instruction hierarchy for task extraction:
    1.  User’s Forwarding Note (Highest priority for explicit instructions).
    2.  Most Recent Message (Top-most reply in the forwarded thread).
    3.  Historical Thread (Lowest priority, used only for resolving pronouns or ambiguous references).
*   **Task Naming (Standard):** LLM shall generate task names following the pattern `[Action] for [Person]`, limited to 250 characters, with temporal expressions removed.
*   **Multi-Party Logic:** If an email involves multiple parties, the task name shall reflect the user's action, e.g., `"Ask Martha to [Action] for Sam"`.
*   **Attachment Handling:** If an email contains or references an attachment, the task title must explicitly state: `"Check [Attachment Type] from [Sender] re: [Original Subject]"`.
*   **Multi-Task Splitting:** If an email contains multiple distinct to-dos, the system shall create a separate task for each to-do.
*   **Temporal Intelligence (Metadata):** Any temporal expressions removed from the title must be converted into a standardized ISO 8601 due_date field.
    * Relative Date Logic: If an email says "due Friday," the LLM must calculate the specific date based on the email's "Date" header, not the current processing time, to ensure accuracy in delayed ingestion.
*   **Action Verbs:** The AI shall prioritize strong, actionable verbs (e.g., "Email," "Review," "Call") rather than passive descriptions (e.g., "Regarding Sam's email").

### 5.3 Reliability and Fallback Mechanisms

*   **De-duplication:** The system shall implement a 24-hour Message-ID Lock. If an email with a specific `Message-ID` has been processed within the last 24 hours, subsequent forwards of that exact message shall be ignored.
*   **AI Extraction Failure Fallback:** If AI extraction fails or no clear action is found, a minimal fallback task shall be created. The `createSafeFallbackTask` mechanism will ensure a task titled `"Review email from [Sender]: [Subject]"` or `"Review email: [Subject]"` (if sender is unclear) is always created.
*   **Prompt Injection Defense:**
    *   A guardrail LLM (Sentinel Model) shall detect instruction-override attempts.
    *   Untrusted content shall be enclosed in explicit delimiters (e.g., `<USER_INPUT_START>`, `<USER_INPUT_END>`) and processed by `sanitizeUserInput`.
    *   AI shall be instructed to treat all sender claims (e.g., "High Priority") as informational data points, not system commands.
*   **Efficient Fan-Out Execution:**To optimize latency and API costs, the AI processing (Sentinel + Extraction) shall occur exactly once per unique Message-ID.
    * Once tasks are extracted, the system shall identify all users monitoring that From address and create the corresponding tasks in their respective accounts simultaneously.    

### 5.4 Data Storage

*   `Message-ID` shall be stored as a direct field on the `tasks` table for de-duplication purposes.
*   Raw `Subject` and `Body` of the original email shall be stored in an `original_request` field on the `tasks` table for internal debugging and context.
    * original_request (Truncated String): * Storage Format: A single string field with a maximum length of 2000 characters.
    * Ingestion Logic: The system shall prioritize the Subject line followed by the Body.
    * Pre-processing: To maximize the utility of the 2000-character limit, the system shall strip known email signatures and legal disclaimers before saving to the database.
    * Overflow Handling: If the combined Subject and Body exceed 2000 characters, the string shall be truncated with an ellipsis (...) at the end to ensure the most relevant context (the beginning of the message) is preserved.

### 5.5 User Interface

*   A user interface shall be developed to allow users to configure and verify email addresses for ingestion.

## 6. Non-Goals

*   Team collaboration or shared task assignment features.
*   Web-app push notifications or non-visual audio confirmations for task creation.
*   Manual task approval or confirmation flows.

## 7. Technical Requirements

*   **Backend:** Node.js, Fastify.
*   **Database:** PostgreSQL.
*   **LLM Integration:** `gpt-4o-mini` via Requesty.ai, with OpenAI `gpt-4o-mini` as a fallback. Existing LLM credentials from voice task creation will be reused.
*   **Email API:** Gmail API.
*   **Frontend:** React, TypeScript, Dexie.js (for IndexedDB).

## 8. Success Metrics

*   **Forwarding Success Rate:** ≥ 99% of forwarded emails successfully result in task creation.
*   **Extraction Accuracy:** ≥ 90% of tasks extracted accurately reflect the user's intent and context.
*   **False Positive Rate:** ≤ 10% of tasks created are immediately deleted by the user.
*   **Latency:** < 15 seconds from email forward to task appearance in the user's task list.

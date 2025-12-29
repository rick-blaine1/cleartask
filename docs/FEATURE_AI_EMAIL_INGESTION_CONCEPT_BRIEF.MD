# Product Concept Brief: AI-Driven Email Ingestion (“Mail-to-Task”)

**Status:** Final Concept (v1.1)

**Target Version:** 1.0

**Product Context:** Personal task-tracking web application (individual use)

---

## 1. Core Objective

Enable users to transform forwarded emails into actionable tasks automatically—without manual review or confirmation—by using AI to interpret intent, extract actions, and assign deadlines. The system is explicitly designed to reduce task-creation friction for users with **low vision** by prioritizing predictable, reversible automation over visual verification.

## 2. Value Proposition

Mail-to-Task offloads cognitive and visual effort by turning ambiguous email requests into explicit personal tasks.
Instead of forcing users to read, parse, and manually re-enter work from an inbox, Mail-to-Task acts as a **personal executive-function assistant**. It interprets unstructured email content from the user’s perspective and ensures that no actionable work remains buried in email threads.

---

## 3. Product Principles

* **Auto-Create by Default:** All forwarded emails result in task creation. No confirmation required.
* **User-Centric Interpretation:** AI extracts tasks based on what the *user* needs to do, ignoring sender-side framing (e.g., “FYI” vs “Urgent”).
*   **Accessibility First:** Initial task creation workflows must not rely on precise visual scanning or manual inline editing. Post-creation editing of tasks is fully supported for refinement and correction.
* **Predictable Over Perfect:** Consistent behavior and easy recoverability (deletion/editing) are prioritized over semantic perfection.
* **Granularity over Consolidation:** Distinct requests are split into individual tasks to ensure each item is independently actionable and trackable.

---

## 4. Intelligence & Extraction Logic

### 4.1 Instruction Hierarchy

1. **User’s Forwarding Note (Highest):** Explicit instructions (e.g., “Do this by Wed”).
2. **Most Recent Message:** The top-most reply in the forwarded thread.
3. **Historical Thread (Lowest):** Used only to resolve pronouns or ambiguous references.

### 4.2 Extraction & Naming Rules

*   **Task Naming (Standard):** LLM should generate task names following the pattern `[Action] for [Person]`, limited to 250 characters, with temporal expressions removed.
* **Multi-Party Logic:** If Sam asks the user to contact Martha, the task is named: `"Ask Martha to [Action] for Sam"`.
* **Attachment Handling:** If an email contains or references an attachment, the title must explicitly state: `"Check [Attachment Type] from [Sender] re: [Original Subject]"`.
* **Multi-Task Splitting:** If an email contains 5 distinct "to-dos," the system creates **5 separate tasks**. This prevents "hidden" work inside a single task description.
*   **Informational Catch-All / Safe Fallback:** If no clear action is found, or if AI extraction fails validation, a task titled `"Review email from [Sender]: [Subject]"` is created. The system's `createSafeFallbackTask` mechanism ensures a minimal task (`"Review email: [Subject]"` or from `original_request`) is always created if the LLM output is malformed or no clear action is identified.

---

## 5. System Reliability & Maintenance

### 5.1 De-duplication Logic

To prevent list clutter and cognitive overhead, the system implements a **24-hour Message-ID Lock**:

* If an email with a specific `Message-ID` has already been processed within the last 24 hours, subsequent forwards of that exact message are ignored.

### 5.2 Prompt Injection Defense

* **Sentinel Model:** A guardrail LLM detects instruction-override attempts (e.g., "Ignore previous instructions").
*   **Delimited Input Wrapping:** Untrusted content is enclosed in explicit delimiters (e.g., `<USER_INPUT_START>`, `<USER_INPUT_END>`) and processed by `sanitizeUserInput` to prevent injection.
* **Semantic Reframing:** AI is instructed to treat all sender claims (e.g., "High Priority") as informational data points, not system commands.

---

## 6. Technical Requirements

### 7.1 Backend Integration

* **Ingestion:** Event-driven polling of Gmail API, feeding into a dedicated `/api/email-ingestion` endpoint.
*   **User Mapping:** Each user will explicitly configure and independently verify 'From' email addresses they wish to watch. The system will match the incoming email's `From` address against these user-configured and verified watch-lists.
* **Failure Handling:** If AI extraction fails, a minimal fallback task is created: `"Review forwarded email: [Subject]"`.
*   **Metadata Storage:** `Message-ID` will be stored as a direct field on the `tasks` table for de-duplication. Raw `Subject` and `Body` are stored in the `original_request` field for internal debugging only.

### 7.2 LLM Model Preference

*   **Model:** Utilize `gpt-4o-mini` for all OpenAI model interactions, adhering to project standards.

### 7.3 Data Schema (Example)

```json
{
  "user_id": "uuid",
  "tasks": [
    {
      "task_name": "Ask Martha to send Sam the file",
      "due_date": "2025-12-30T17:00:00Z",
      "message_id": "abc-123",
      "original_request": "Full raw email body and subject for debug/context."
    }
  ]
}

```

---

## 7. Non-Goals

* Team collaboration or shared task assignment.
* Web-app push notifications or non-visual audio confirmations.
* Manual task approval or confirmation flows.

---

## 8. Success Metrics

* **Forwarding Success Rate:** ≥ 99%.
* **Extraction Accuracy:** ≥ 90%.
* **False Positive Rate:** ≤ 10% (immediate deletions).
* **Latency:** < 15 seconds from forward to task appearance.

---

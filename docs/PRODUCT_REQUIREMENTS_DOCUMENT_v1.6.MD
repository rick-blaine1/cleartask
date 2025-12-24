# Product Requirements Document (PRD): ClearTask Prototype (v1.6 Master)

**Status:** FINALIZED - PRODUCTION READY  
**Primary Browser Target:** Chrome (iOS & Desktop)  
**Timezone Context:** Canada/Pacific (Vancouver)

---

## 1. Product Philosophy
ClearTask is a **voice-first, accessibility-centered task manager** designed to reduce cognitive load for users with low vision.
* **Understandable via audio alone:** Every visual state change must have a corresponding Text-to-Speech (TTS) announcement.
* **Fail Loudly:** No silent errors. If a process fails, the user is notified immediately via audio.
* **Predictable Layout:** UI elements must remain stable; avoid "jumping" or moving without explicit user intent.

---

## 4. Interaction Model (Voice & Audio)

### 4.3 Audio Feedback (TTS) & Standardized Response Scripts
All successful, destructive, or failed actions must be confirmed via browser Text-to-Speech.

**Standardized Scripts:**
* **Creation:** “Task saved: [Task Name] for [Date or 'no date'].”
* **Deletion Initiation:** “Are you sure you want to delete [Task Name]? Say 'yes' to confirm or 'no' to cancel.”
* **Deletion Finalized:** “Task deleted: [Task Name].”
* **Deletion Cancelled:** “Deletion cancelled. Returning to list.”
* **Ambiguity/Retry:** “I heard you mention [Context], but I didn't catch the task. What should I remind you about?”
* **Connectivity Failure (Fail Loudly):** “I'm having trouble connecting to the brain right now. I've saved your recording locally and will sync it when I'm back online.”

---

## 5. Functional Requirements

### 5.3 Deletion Logic & Confirmation Gating
Deletion is initiated via voice command only to prevent accidental data loss.

1. **The Gate:** Upon a deletion request, the app enters a "Pending Deletion" state. The target task is visually highlighted in **Electric Yellow**.
2. **Explicit Confirmation:** The system speaks the Deletion Initiation script and re-opens the microphone.
3. **User Intent:**
    * **Yes:** The task is permanently removed from the database.
    * **No / Mic Tap / 10s Timeout:** The deletion is aborted, the UI "unlocks," and the app confirms cancellation via TTS.
4. **Specificity:** If multiple tasks match a deletion request, the app must reject the action and ask for specificity: “I found multiple tasks for [Keyword]. Which one did you want to delete?”

### 5.4 Original Request Storage
* **Original Request:** Database stores transcription of original audio request sent to LLM for debugging reasons. This is never displayed to the user.

---

## 6. Task List & Sorting

### 6.1 Display Format
Each task is displayed as a single, continuous string:  
`[Task Content] — [Written Date | No Date]`

### 6.2 Priority Rules
1. **Tier 1 (Electric Yellow Border):** Tasks with `due_date = NULL`. These always appear at the top.
2. **Tier 2 (White Text):** Tasks with a due date, sorted chronologically ascending.

---

## 7. Onboarding & Error Handling
* **Cognitive Model Disclosure:** Audio onboarding plays on first launch: “Tasks without dates appear first, so nothing important gets buried.”
* **Offline Support:** Voice-captured tasks must be cached locally in IndexedDB if connectivity drops and synced automatically upon reconnection.

## 8. Technical Specifications

### 8.1 Authentication & User Identity
* **Provider:** Google OAuth 2.0.
* **Flow:** Full-page redirect flow is mandatory to ensure compatibility with screen magnifiers and browser-level zoom tools.
* **Session Persistence:** Users should remain logged in across sessions to minimize repetitive high-friction login actions.

### 8.2 Database & Query Logic
* **Type:** Relational SQL (PostgreSQL preferred).
* **Task Storage:** Every entry must store the `task_content`, a nullable `due_date`, and the `original_request` transcript for developer debugging.
* **Priority Sorting Query:** The system must strictly follow the "Nulls First" chronological sort:
  ~~~~sql
    SELECT * FROM tasks 
    WHERE user_id = 'current_user_id' AND is_completed = false
    ORDER BY due_date ASC NULLS FIRST;
  ~~~~

### 8.3 Timezone Handling
* **Anchor:** Canada/Pacific (Vancouver).
* **Normalization:** All relative dates (e.g., "tomorrow") must be converted to absolute YYYY-MM-DD format by the LLM using the current Vancouver time as the reference.

---

## 9. Out of Scope (v1.6)
To maintain the simplicity required for a low-vision prototype, the following features are explicitly excluded:
* **Collaboration:** No task sharing or multi-user lists.
* **Reminders:** No push notifications, proximity alerts, or recurring task logic.
* **Passive Input:** No "always-on" background listening or wake-word activation.
* **Localization:** Support is limited to the English language only for the initial prototype.
* **Sub-tasks:** No nested checklists or complex project hierarchies.
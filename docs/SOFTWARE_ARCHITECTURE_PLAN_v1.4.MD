# Software Architecture Plan: ClearTask (v1.4 Master)

## 1. Overview
ClearTask is a **voice-driven, accessibility-first task manager**. This document defines the technical execution of the "Fail Loudly" philosophy, ensuring high resiliency through API failover and safe destructive actions via a voice-gated state machine.

---

## 2. System Architecture

### 2.1 High-Level Flow
- **Browser**: Handles UI, Web Speech API (STT), Haptics, and Audio Feedback.
- **Backend API**: Fastify + TypeScript managing logic, Auth, and Resilient AI integration.
- **Database**: PostgreSQL for persistent, user-scoped storage.
- **External**: Requesty (Primary LLM) and OpenAI (Fallback LLM).

---

## 3. Frontend Architecture (React + TypeScript)

### 3.1 Responsibilities & Hardware Constraints
- **Voice Capture**: Manual microphone toggle with haptic/audio "blips".
- **iOS/Chrome Audio Constraints (Hardware Permission Strategy)**:
    - **The Problem**: iOS and Chrome often block Text-to-Speech (TTS) and audio playback unless triggered by an explicit user gesture.
    - **The Solution**: The manual microphone toggle tap must be used to "unlock" the browser's AudioContext.
    - **Implementation**: On the first "Start Recording" tap, the frontend must initialize a silent audio buffer or play a 0-volume sound to establish permission. This ensures that the latency "pulse" and the final "Success" TTS can play automatically without further user intervention.
- **Latency Management**: Plays a low-volume "processing" pulse sound during API wait times.
- **UI Locking**: During destructive confirmation flows, the task list is visually and functionally "locked" to prevent accidental taps.

### 3.2 Deletion Confirmation State Machine
- **Trigger**: Backend identifies a deletion intent via NLP.
- **State Persistence**: Memory-only (Frontend). If the app refreshes or crashes, the pending deletion is wiped for safety.
- **Voice Timeout**: The app waits **10 seconds** for a "Yes" or "No" verbal confirmation.
- **Cancellation**: A verbal "No" or a **physical tap on the microphone button** instantly cancels the deletion and unlocks the UI.

---

## 4. Intelligence Layer & Resiliency

### 4.1 AI Failover Logic
1. **Primary Call**: Attempt request via **Requesty** (GPT-4o mini).
2. **Timeout**: If Requesty hangs for more than **3 seconds**, the backend aborts and switches to the fallback.
3. **Fallback**: Call **OpenAI API** directly (GPT-4o mini).
4. **Final Failure**: Trigger "Fail Loudly" TTS: “I'm having trouble connecting to the brain. Recording saved locally.”

### 4.2 GPT-4o mini System Prompt
- **Anchor**: Today is [SERVER_TIME_VANCOUVER] (Pacific Time).
- **Ambiguity**: If intent is unclear, set `is_ambiguous: true`.
- **Contextual Clarification**: Generate a `clarification_prompt` based on heard context.

**Output Schema:**
~~~~json
{
  "task_name": "string",
  "due_date": "YYYY-MM-DD | null",
  "is_ambiguous": boolean,
  "clarification_prompt": "string | null"
}
~~~~

---

## 5. Database Architecture

### 5.1 Schema: `tasks` table
- **id**: UUID.
- **user_id**: String (Google OAuth ID).
- **task_name**: Text.
- **due_date**: Date (Nullable; NULL = Tier 1 Priority).
- **original_request**: Text (Raw transcript for debugging).
- **is_completed**: Boolean (Default: false).

### 5.2 Sorting Logic (PostgreSQL)
~~~~sql
SELECT * FROM tasks 
WHERE user_id = 'current_user' AND is_completed = false 
ORDER BY (due_date IS NOT NULL), due_date ASC;
~~~~

---

## 6. Authentication & Security
- **Auth**: Google OAuth 2.0 via `passport-google-oauth20` using full-page redirects.
- **Persistence**: `fastify-jwt` for secure session handling.

---

## 7. Deployment Summary
- **Docker**: Nginx (Frontend), Fastify (Backend), Postgres (DB).
- **Sync**: Automatic background sync on browser `online` event.
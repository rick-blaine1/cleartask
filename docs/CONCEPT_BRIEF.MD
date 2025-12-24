# Project Concept Brief: ClearTask (Low-Vision Accessible)

## 1. Vision Statement
To provide a high-clarity, voice-first task management experience for individuals with low vision. The application prioritizes extreme legibility, intuitive voice interactions, and a "zero-buried-tasks" philosophy.

---

## 2. User Experience & Accessibility
### Visual Design (Design System)
* **Typography:** Primary font is **Atkinson Hyperlegible**. Fallback is **Sans-Serif**.
* **Sizing:** Base text starts at **24px**, supporting up to **200% scaling** without layout breakage.
* **Spacing:** **1.5x line spacing** to prevent line-skipping while reading.
* **Color Palette (WCAG AAA):**
    * **Background:** OLED Black (#000000).
    * **Standard Text:** White (#FFFFFF).
    * **Highlight/Priority Border:** Electric Yellow (#FFFF00).
* **Touch Targets:** Minimum **80px x 80px** for all interactive elements.

### Interaction Model
* **Voice-First Creation:** Primary input via **Web Speech API**.
* **Voice Editing:** Users can modify tasks via natural language (e.g., "Change the milk task to Monday").
* **Audio Feedback:** Integrated **Text-to-Speech (TTS)** voice to confirm actions (e.g., "Added: Buy dog food for Tomorrow").
* **Error Handling:** High-contrast "Tap to Try Again" button with an audio prompt if voice input is unclear.

---

## 3. Intelligence Layer (GPT-4o mini)
The app uses an LLM to parse messy voice transcripts into structured data:
* **Natural Language Processing:** Extracts `task`, `due_date`, and `assignee` from casual speech.
* **Date Normalization:** Converts relative terms (e.g., "next Wednesday") into `YYYY-MM-DD`.
* **Contextual Editing:** Matches voice commands to existing database entries to perform updates.

---

## 4. Functional Requirements
### Task Schema
| Field | Type | Logic |
| :--- | :--- | :--- |
| `task_content` | String | The core text of the task. |
| `due_date` | Date/Null | If `Null`, displays as "None" and sorts to the top. |
| `assignee` | String/Null | Optional; identifies who the task is for. |
| `status` | Boolean | Completed vs. Active. |

### Task Organization & Logic
* **Global List View:** Displays all active tasks in a single, high-contrast scrolling list.
* **Prioritization:** Tasks with **no due date** are treated as "Highest Priority."
* **Visual Hierarchy:** 1. **Top Tier:** No-Date Tasks (Yellow Border / Date Label: "None").
    2. **Chronological Tier:** Tasks with dates (White Text / Sorted ASC).

---

## 5. Technical Architecture
### Frontend
* **Platform:** Responsive Web App / Progressive Web App (PWA).
* **Auth:** **Google OAuth 2.0** using full-page redirects (not pop-ups) for better zoom compatibility.

### Backend & Database
* **Database:** Relational (PostgreSQL or SQLite).
* **Query Logic (Nulls First):** `SELECT * FROM tasks ORDER BY due_date ASC NULLS FIRST;`
  *(Note: For databases like MySQL/SQLite that don't support `NULLS FIRST`, we use: `ORDER BY (due_date IS NOT NULL), due_date ASC`)*
* **API:** Server-side bridge between the Web Speech transcript and the GPT-4o mini extraction layer.
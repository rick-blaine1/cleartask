# Agent Rules Standard (AGENTS.md):
# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## Project-Specific Code Style/Patterns (Non-Obvious Only)

### Frontend
- **IndexedDB Usage:** Tasks are managed client-side using Dexie.js ([`frontend/src/db.ts`](frontend/src/db.ts)).
- **TypeScript Strictness:** High strictness enforced in [`frontend/tsconfig.app.json`](frontend/tsconfig.app.json) including `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, and `noUncheckedSideEffectImports`.
- **Module Syntax:** `verbatimModuleSyntax: true` is set in [`frontend/tsconfig.app.json`](frontend/tsconfig.app.json).
- **AudioContext Initialization:** AudioContext is explicitly initialized upon user interaction ([`frontend/src/App.tsx:29-50`](frontend/src/App.tsx:29-50)).
- **TaskCard UI State Management:** The `TaskCard` component has specialized UI state management ([`frontend/src/components/TaskCard.tsx`](frontend/src/components/TaskCard.tsx)).

### Backend
- **Database Access:** Direct `pg` pool usage with parameterized queries.
- **Authentication:** Custom JWT generation after successful Google OAuth; Google's raw access token is NOT used directly by the frontend ([`backend/app.js:127`](backend/app.js:127)).
- **CORS:** Implemented using `@fastify/cors` to allow requests from the frontend, configurable via `FRONTEND_URL`.
- **LLM Fallback Mechanism:** A critical fallback mechanism for LLM responses is implemented ([`backend/app.js:188-227`](backend/app.js:188-227)).
- **Database Schema Initialization:** The database schema is initialized directly within `backend/app.js` ([`backend/app.js:323-348`](backend/app.js:323-348)).

## Testing Setup (Non-Obvious)

### Frontend (Vitest)
- Test files are located in `**/tests/**/*.test.ts` relative to the project root for Vitest to pick them up.
- `environment: 'node'` and `globals: true` are configured in `frontend/vitest.config.ts`.
- Single test command: `vitest run <file_path>`

### Backend (Node.js Native Test Runner)
- Test files are located in `backend/tests/`.
- Single test command: `cross-env NODE_ENV=test node --test backend/tests/<file_name>.test.js`
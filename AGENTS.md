# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## Project Overview

This project is a monorepo containing a React frontend (Vite, TypeScript, Dexie.js) and a Fastify (Node.js, PostgreSQL) backend.

## Build/Lint/Test Commands (Non-Obvious)

### Frontend
- `npm test`: Runs Vitest tests once.
- `npm run test:watch`: Runs Vitest tests in watch mode.

### Backend
- `npm test`: Runs Node.js native tests (not a separate framework like Jest).

### Docker Compose
- `docker-compose up --build`: Builds and starts both frontend and backend services along with a PostgreSQL database.

## Environment Variables (Defaults if not set)

### Backend (`backend/app.js`)
- `JWT_SECRET`: Defaults to `supersecretjwtkey`.
- `DB_USER`: Defaults to `user`.
- `DB_HOST`: Defaults to `localhost`.
- `DB_NAME`: Defaults to `cleartaskdb`.
- `DB_PASSWORD`: Defaults to `password`.
- `DB_PORT`: Defaults to `5432`.

### Frontend (`docker-compose.yml`)
- `VITE_APP_API_BASE_URL`: Defaults to `http://localhost:3000`.

### Shared (Google OAuth2)
- `GOOGLE_CLIENT_ID`: Used by both frontend (as `VITE_GOOGLE_CLIENT_ID`) and backend.
- `GOOGLE_CLIENT_SECRET`: Used by backend.

## Project-Specific Code Style/Patterns (Non-Obvious)

### Frontend
- **IndexedDB Usage:** Tasks are managed client-side using Dexie.js (`frontend/src/db.ts`).
- **TypeScript Strictness:** High strictness enforced in `frontend/tsconfig.app.json` including `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, and `noUncheckedSideEffectImports`.
- **Module Syntax:** `verbatimModuleSyntax: true` is set in `frontend/tsconfig.app.json`.

### Backend
- **Database Access:** Direct `pg` pool usage with parameterized queries (`backend/app.js`).
- **Authentication:** JWT and Google OAuth2 (`@fastify/jwt`, `@fastify/oauth2`) are used for authentication.

## Testing Setup (Non-Obvious)

### Frontend (Vitest)
- Test files are located in `**/tests/**/*.test.ts` relative to the project root for Vitest to pick them up.
- `environment: 'node'` and `globals: true` are configured in `frontend/vitest.config.ts`.

### Backend (Node.js Native Test Runner)
- Test files are located in `backend/tests/` and executed directly via `node --test`.
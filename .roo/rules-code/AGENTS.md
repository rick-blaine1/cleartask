## Project-Specific Code Style/Patterns (Non-Obvious Only)

### Frontend
- **IndexedDB Usage:** Tasks are managed client-side using Dexie.js ([`frontend/src/db.ts`](frontend/src/db.ts)).
- **TypeScript Strictness:** High strictness enforced in [`frontend/tsconfig.app.json`](frontend/tsconfig.app.json) including `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, and `noUncheckedSideEffectImports`.
- **Module Syntax:** `verbatimModuleSyntax: true` is set in [`frontend/tsconfig.app.json`](frontend/tsconfig.app.json).

### Backend
- **Database Access:** Direct `pg` pool usage with parameterized queries ([`backend/app.js`](backend/app.js)).
- **Authentication:** JWT and Google OAuth2 (`@fastify/jwt`, `@fastify/oauth2`) are used for authentication.
  - The backend generates its own JWT after successful Google OAuth, signed with `JWT_SECRET` and containing `userId`.
  - Google's raw access token is NOT used directly by the frontend.
- **CORS:** Implemented using `@fastify/cors` to allow requests from the frontend, configurable via `FRONTEND_URL`.
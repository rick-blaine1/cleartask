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
- **NOTE FOR AGENTS**: When testing endpoints protected by JWT, you'll need a valid JWT. The `mock-jwt-signature` used in curl commands will not work. A valid JWT can be obtained by completing the Google OAuth flow (e.g., via browser interaction with `/api/auth/google`) and extracting the token from the redirect URL, or by programmatically signing a token with the correct `JWT_SECRET` (which defaults to `supersecretjwtkey`). Due to environment limitations in the sandbox (e.g., `jsonwebtoken` not directly available for scripting, `grep` not in Windows `cmd`), generating a valid JWT purely within the sandbox for `curl` testing is challenging. Manual testing or a more sophisticated testing setup outside the sandbox may be required.
- **CORS:** Implemented using `@fastify/cors` to allow requests from the frontend, configurable via `FRONTEND_URL`.
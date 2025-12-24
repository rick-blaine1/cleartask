# Project Coding Rules (Non-Obvious Only)
- **IndexedDB Usage:** Tasks are managed client-side using Dexie.js (`frontend/src/db.ts`).
- **TypeScript Strictness:** High strictness enforced in `frontend/tsconfig.app.json` including `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, and `noUncheckedSideEffectImports`.
- **Module Syntax:** `verbatimModuleSyntax: true` is set in `frontend/tsconfig.app.json`.
- **Database Access:** Direct `pg` pool usage with parameterized queries (`backend/app.js`).
- **Authentication:** JWT and Google OAuth2 (`@fastify/jwt`, `@fastify/oauth2`) are used for authentication.
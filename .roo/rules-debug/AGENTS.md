# Project Debug Rules (Non-Obvious Only)

## Testing Setup (Non-Obvious Only)

### Frontend (Vitest)
- Test files are located in `**/tests/**/*.test.ts` relative to the project root for Vitest to pick them up.
- `environment: 'node'` and `globals: true` are configured in [`frontend/vitest.config.ts`](frontend/vitest.config.ts).

### Backend (Node.js Native Test Runner)
- Test files are located in `backend/tests/` and executed directly via `node --test`.
# Project Architecture Rules (Non-Obvious Only)

- **Monorepo Structure:** The project is a monorepo consisting of a React (Vite, TypeScript, Dexie.js) frontend and a Fastify (Node.js, PostgreSQL) backend.
- **Authentication Flow:** The backend handles authentication via JWT and Google OAuth2. After successful Google OAuth, the backend generates and signs its own JWT (`JWT_SECRET`) containing the `userId`. Google's raw access token is not directly used by the frontend.
- **Client-Side Data Management:** Tasks are managed client-side using Dexie.js for IndexedDB, defined in [`frontend/src/db.ts`](frontend/src/db.ts).
- **OpenAI Integration:** The backend uses the OpenAI API for task suggestions. A fallback suggestion ("Consider organizing your desk.") is provided if `OPENAI_API_KEY` is not configured or if the API call times out after 3 seconds.
- **CORS Configuration:** CORS is explicitly implemented in the backend via `@fastify/cors`, allowing requests from the frontend URL configurable via `FRONTEND_URL`.
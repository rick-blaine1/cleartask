# Project Architecture Rules (Non-Obvious Only)

- **Authentication Flow:** The backend generates its own JWT after successful Google OAuth, signed with `JWT_SECRET` and containing `userId`. Google's raw access token is not directly used by the frontend.
- **Client-Side Data Management:** Tasks are managed client-side using Dexie.js for IndexedDB, defined in [`frontend/src/db.ts`](frontend/src/db.ts).
- **OpenAI Integration:** The backend uses the OpenAI API for task suggestions. A fallback suggestion ("Consider organizing your desk.") is provided if `OPENAI_API_KEY` is not configured or if the API call times out after 3 seconds.
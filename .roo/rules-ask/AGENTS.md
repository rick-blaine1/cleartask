# Project Documentation Rules (Non-Obvious Only)
- After Google login, the frontend currently displays mock task data. The JWT token received from the backend upon successful authentication is not yet consumed or used to fetch real tasks.

## Build/Lint/Test Commands (Non-Obvious)

### Frontend
- `npm test`: Runs Vitest tests once.
- `npm run test:watch`: Runs Vitest tests in watch mode.

### Backend
- `npm test`: Runs Node.js native tests (not a separate framework like Jest).

### Docker Compose
- `docker-compose up --build`: Builds and starts both frontend and backend services along with a PostgreSQL database.

## Environment Variables (Defaults if not set)

### Backend ([`backend/app.js`](backend/app.js))
- `JWT_SECRET`: Defaults to `supersecretjwtkey`.
- `DB_USER`: Defaults to `user`.
- `DB_HOST`: Defaults to `localhost`.
- `DB_NAME`: Defaults to `cleartaskdb`.
- `DB_PASSWORD`: Defaults to `password`.
- `DB_PORT`: Defaults to `5432`.
- `BASE_URL`: Defaults to `http://localhost:3000`. Used to construct the full `callbackUri` for Google OAuth.
- `FRONTEND_URL`: Defaults to `http://localhost:5173`. Used for CORS and OAuth redirection.

### Frontend (`docker-compose.yml`)
- `VITE_APP_API_BASE_URL`: Defaults to `http://localhost:3000`.

### Shared (Google OAuth2)
- `GOOGLE_CLIENT_ID`: Used by both frontend (as `VITE_GOOGLE_CLIENT_ID`) and backend.
- `GOOGLE_CLIENT_SECRET`: Used by backend.
- `OPENAI_API_KEY`: Used by the backend to enable OpenAI API calls. If not provided, a fallback suggestion is used.

# Project Architecture Overview

This document outlines the core architecture of the ClearTask project, identifying main components, their interactions, key entry points for both frontend and backend, and the integration of the Docker setup.

## 1. High-Level Overview

The ClearTask application follows a client-server architecture, with a React-based frontend and a Node.js (Fastify) backend. Data persistence is handled by a PostgreSQL database. The entire application is containerized using Docker and orchestrated with Docker Compose for both development and production environments.

```mermaid
graph TD
    Browser[User's Web Browser] --> |Serves HTML, CSS, JS| Frontend(React Application)
    Frontend --> |API Requests (HTTP)| Backend(Node.js Fastify API)
    Backend --> |Database Operations (pg)| PostgreSQL(Database)
    Backend --> |LLM Integration (OpenAI/Requesty)| LLM[Large Language Model]
    subgraph Docker Containers
        Frontend
        Backend
        PostgreSQL
    end
    subgraph User Interaction
        Browser
    end
    subgraph External Services
        LLM
    end
```

## 2. Frontend Architecture

The frontend is a React application built with Vite and TypeScript. It provides the user interface for task management, including displaying tasks, handling user input (text and voice), and interacting with the backend API.

-   **Entry Point**: The application starts at [`frontend/src/main.tsx`](frontend/src/main.tsx), which renders the main [`App`](frontend/src/App.tsx) component into the DOM.
-   **Core Component**: The [`App.tsx`](frontend/src/App.tsx) component manages the overall application state, including user authentication status, the list of tasks, and speech recognition functionality. It orchestrates interactions with the backend and handles UI logic like task sorting and deletion confirmations.
-   **State Management**: React's `useState` and `useEffect` hooks are used for managing local component state. Global task data is fetched from and sent to the backend API. User tasks are also persisted client-side using Dexie.js, an IndexedDB wrapper (see [`frontend/src/db.ts`](frontend/src/db.ts)).
-   **Components**: Key UI components include `TaskCard` ([`frontend/src/components/TaskCard.tsx`](frontend/src/components/TaskCard.tsx)), responsible for displaying individual tasks and handling their specific interactions (edit, complete, delete). It also manages its own UI state for editing.
-   **API Interaction**: The frontend communicates with the backend via HTTP requests, primarily using `fetch`. Authentication tokens (JWTs) received from the backend are stored in `localStorage` and sent with subsequent API requests.
-   **Voice Input and TTS**: Utilizes the Web Speech API (`webkitSpeechRecognition`) for voice input and a custom Text-to-Speech (TTS) module (`tts.ts`) for audio feedback.
-   **AudioContext**: Explicitly initializes `AudioContext` upon user interaction to ensure proper audio playback for feedback.

```mermaid
graph TD
    User[User] --> |Voice Input/Clicks| App(App.tsx - Main Application)
    App --> |Displays Tasks| TaskList(List of TaskCard Components)
    TaskList --> TaskCard1[TaskCard (Task 1)]
    TaskList --> TaskCardN[TaskCard (Task N)]
    App --> |Manages Global State| ReactState(React useState/useEffect)
    App --> |API Calls| Backend(Node.js Fastify API)
    App --"Persists Tasks (Local)"--> IndexedDB[IndexedDB via Dexie.js]
    App --"Provides Audio Feedback"--> TTS[Text-to-Speech (`tts.ts`)]
    App --"Captures Speech"--> WebSpeechAPI[Web Speech API]
    App --"Initializes on Interaction"--> AudioContext[AudioContext]
```

## 3. Backend Architecture

The backend is a Node.js application built with Fastify, providing a RESTful API for task management and authentication. It interacts with a PostgreSQL database and integrates with Large Language Models (LLMs) for natural language processing of voice commands.

-   **Entry Point**: The backend application is initialized and started in [`backend/app.js`](backend/app.js) (outside of test environment), which sets up the Fastify server, registers plugins, and defines API routes.
-   **Authentication**: Uses `@fastify/jwt` for JWT-based authentication and `@fastify/oauth2` for Google and Microsoft OAuth. After successful OAuth, the backend generates its own JWT for client-side use, enhancing security by not directly exposing external access tokens.
-   **Database**: PostgreSQL is used for data storage. The `pg` library is used for direct database interactions. The schema (users and tasks tables) is initialized within [`backend/app.js`](backend/app.js) on application startup.
-   **API Endpoints**: Key endpoints include:
    -   `/api/auth/google`, `/api/auth/microsoft`: OAuth initiation.
    -   `/api/auth/google/callback`, `/api/auth/microsoft/callback`: OAuth callbacks for token exchange and user creation/login.
    -   `/api/tasks`: GET for fetching tasks.
    -   `/api/tasks/create-from-voice`: POST for creating/updating tasks using LLM-parsed voice input.
    -   `/api/tasks/:id`: PUT for updating, DELETE for deleting tasks.
    -   `/api/tasks/:id/archive`: PUT for archiving tasks.
-   **LLM Integration**: The backend integrates with OpenAI and Requesty.ai for processing voice transcripts into structured task data. It implements a fallback mechanism: if Requesty.ai fails or times out, it falls back to OpenAI. If both fail or are not configured, a simple text-based fallback is used.
-   **CORS**: Configured using `@fastify/cors` to allow requests from the frontend URL, ensuring secure cross-origin communication.

```mermaid
graph TD
    Frontend --> |Google OAuth| Google[Google OAuth Service]
    Frontend --> |Microsoft OAuth| Microsoft[Microsoft OAuth Service]
    Frontend --> |API Requests| Fastify(Fastify Application - `app.js`)
    Fastify --> JWT[JWT Authentication]
    Fastify --> PG[PostgreSQL Database (via `pg`)]
    Fastify --> |Auth Callback| Google
    Fastify --> |Auth Callback| Microsoft
    Fastify --> |Voice/Text Commands| LLM_Router(LLM Integration)
    LLM_Router --> |Primary| RequestyAI[Requesty.ai (OpenAI/GPT-4o-mini)]
    LLM_Router --> |Fallback if all fail| SimpleFallback[Simple Text Fallback]
    Fastify --> CRUD[Task CRUD Operations]
    CRUD --> PG
```

## 4. Docker Setup

The project uses Docker and Docker Compose to create a reproducible and scalable development and production environment.

-   **`docker-compose.yml` (Development)**:
    -   Defines three services: `frontend`, `backend`, and `db`.
    -   `frontend`: Builds from `frontend/Dockerfile` (development stage), maps port 5173, mounts the frontend directory for hot-reloading, and sets `VITE_APP_API_BASE_URL` to point to the backend service.
    -   `backend`: Builds from `backend/Dockerfile` (development stage), maps port 3000, mounts the backend directory, and uses an `.env` file for environment variables. It waits for the `db` service to be healthy.
    -   `db`: Uses the `postgres:16-alpine` image, maps port 5432, and persists data using a Docker volume (`db_data`). Includes a `healthcheck` to ensure the database is ready before the backend attempts to connect.

-   **`docker-compose.prod.yml` (Production)**:
    -   Also defines `frontend`, `backend`, and `db` services, optimized for production deployment.
    -   `frontend`: Builds from `frontend/Dockerfile` (production stage), which uses Nginx to serve the static build artifacts. Maps port 80.
    -   `backend`: Builds from `backend/Dockerfile` (production stage), maps port 3000. Uses an `.env` file and sets `NODE_ENV=production`.
    -   `db`: Similar to development, but typically does not expose port 5432 externally and uses a separate volume (`db_prod_data`).
    -   **Networking**: Defines a custom `cleartask-network` to facilitate communication between services in production.

-   **`backend/Dockerfile`**:
    -   A multi-stage Dockerfile.
    -   `base` stage: Installs Node.js dependencies.
    -   `development` stage: Copies source code, runs `npm run dev` for development with hot-reloading.
    -   `build` stage: Copies source, performs `npm run build` (if applicable for TypeScript compilation).
    -   `production` stage: Copies only necessary production dependencies and built artifacts, runs as a non-root user, includes a healthcheck, and runs `npm start`.

-   **`frontend/Dockerfile`**:
    -   A multi-stage Dockerfile.
    -   `base` stage: Installs Node.js dependencies.
    -   `development` stage: Copies source code, runs `npm run dev` with `--host 0.0.0.0` for Docker compatibility.
    -   `build` stage: Copies source, sets `VITE_APP_API_BASE_URL` and `VITE_GOOGLE_CLIENT_ID` as build arguments, and runs `npm run build` to create static assets.
    -   `production` stage: Uses an Nginx `stable-alpine` image, copies the built frontend `dist` directory to Nginx's web root (`/usr/share/nginx/html`), and serves the static files.

```mermaid
graph TD
    UserLocal[Local Developer] --> |`docker compose up`| DockerComposeDev(docker-compose.yml)
    UserProd[Production User] --> |Web Browser| NginxProd(Nginx in Frontend Production Container)

    subgraph Local Development Environment
        DockerComposeDev --> FrontendDev(Frontend Container - Dev Mode)
        DockerComposeDev --> BackendDev(Backend Container - Dev Mode)
        DockerComposeDev --> DBDev(PostgreSQL Container - Dev)
        FrontendDev --"Watches /app volume"--> FrontendCode[Local Frontend Code]
        BackendDev --"Watches /app volume"--> BackendCode[Local Backend Code]
    end

    subgraph Production Environment
        DockerComposeProd(docker-compose.prod.yml) --> FrontendProd(Frontend Container - Prod Mode)
        DockerComposeProd --> BackendProd(Backend Container - Prod Mode)
        DockerComposeProd --> DBProd(PostgreSQL Container - Prod)
        FrontendProd --"Serves static files"--> NginxProd
        NginxProd --"Container 80->80"--> FrontendProd
        BackendProd --"Container 3000->3000"--> FrontendProd
        DBProd --"Container (internal)"--> BackendProd
    end

    FrontendDev --> |API (localhost:3000)| BackendDev
    BackendDev --> |DB (db:5432)| DBDev

    FrontendProd --> |API (PROD_API_URL)| BackendProd
    BackendProd --> |DB (db:5432)| DBProd
```

## 5. Key Interactions and Data Flow

1.  **User Authentication**: User interacts with frontend to login via Google/Microsoft OAuth. Frontend redirects to backend's OAuth endpoint, which in turn redirects to the OAuth provider. Upon successful authentication, the provider redirects back to the backend callback, where a custom JWT is generated and sent back to the frontend (via URL hash). The frontend stores this JWT.
2.  **Task Management (CRUD)**: Frontend makes authenticated API requests to the backend for creating, reading, updating, and deleting tasks. The backend validates the JWT, performs the requested operation on the PostgreSQL database, and returns the result.
3.  **Voice Input Processing**: User speaks a command into the frontend. The `webkitSpeechRecognition` API transcribes it. The frontend sends this transcript to the backend's `/api/tasks/create-from-voice` endpoint. The backend uses an LLM (with fallback) to parse the natural language into structured task data (e.g., task name, due date, intent). Based on the LLM's output, the backend either creates a new task or updates an existing one in the PostgreSQL database.
4.  **UI Feedback**: The frontend provides visual feedback (e.g., task list updates) and auditory feedback (TTS, haptics) to the user based on API responses and internal state changes.
5.  **Database Schema Initialization**: On backend startup (outside of test environment), `backend/app.js` connects to PostgreSQL and ensures that the `users` and `tasks` tables exist with the correct schema, creating them if necessary.

This architecture provides a clear separation of concerns, leverages Docker for consistent environments, and integrates AI capabilities for an enhanced user experience.

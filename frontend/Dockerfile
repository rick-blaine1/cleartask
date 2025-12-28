# --- Stage 1: Base (Shared dependencies) ---
FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json ./
# 'npm ci' is cleaner and faster for automated builds
RUN npm ci

# --- Stage 2: Development (Vite Dev Server) ---
FROM base AS development
EXPOSE 5173
COPY . .
# --host is mandatory for Docker, --polling handles Windows/Mac file sync issues
# CMD ["npm", "run", "dev"]
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

# --- Stage 3: Build (Production compilation) ---
FROM base AS build
COPY . .
# Vite requires env vars at build time to "bake" them into the JS
ARG VITE_APP_API_BASE_URL
ARG VITE_GOOGLE_CLIENT_ID
ENV VITE_APP_API_BASE_URL=$VITE_APP_API_BASE_URL
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID

RUN npm run build

# --- Stage 4: Production Runtime (Nginx) ---
FROM nginx:stable-alpine AS production
# Copy the static 'dist' folder from build stage to Nginx's web root
COPY --from=build /app/dist /usr/share/nginx/html

# EXPOSE 80 is the standard for HTTP traffic
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
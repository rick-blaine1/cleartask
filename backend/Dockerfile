# --- Stage 1: Base ---
FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json ./
RUN npm ci

# --- Stage 2: Development ---
FROM base AS development
COPY . .
# Assumes you have a "dev" script in package.json (e.g., nodemon)
CMD ["npm", "run", "dev"]

# --- Stage 3: Production Build ---
FROM base AS build
COPY . .
# Run build if you use TypeScript; otherwise, this stage just passes through
RUN npm run build --if-present

# --- Stage 4: Production Runtime ---
FROM node:20-alpine AS production
WORKDIR /app
# Security: Run as non-root user
USER node
# Copy only production dependencies and built files
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app .

# Healthcheck to ensure API is responding
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

EXPOSE 3000
CMD ["npm", "start"]
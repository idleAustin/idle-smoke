# -------------------------------------------------------------
# Stage 1: Application Builder
# -------------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app

# Install build dependencies
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY . .
ENV BASE_URL=/idle-smoke/
RUN npm run build --if-present

# -------------------------------------------------------------
# Stage 2: Minimal Production Runtime (Non-Root)
# -------------------------------------------------------------
FROM node:22-alpine
WORKDIR /app

# Copy production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled artifacts from builder and server code owned by non-root node user
COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node server/ ./server/

# Production Environment
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# Drop root privileges
USER node

# Run with Node (or via Doppler when Doppler CLI is installed inside image)
CMD ["node", "server/index.js"]

# Multi-stage lightweight production Dockerfile
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependency specifications
COPY package*.json ./

# Install all dependencies (including dev for building)
RUN npm ci || npm install

# Copy application source
COPY . .

# Build frontend production bundle
RUN npm run build

# Production runner stage
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --omit=dev || npm install --omit=dev

# Copy build artifacts and server code
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY --from=builder /app/server.js ./server.js
COPY --from=builder /app/server ./server
COPY --from=builder /app/services ./services
COPY --from=builder /app/utils ./utils
COPY --from=builder /app/types.ts ./types.ts
COPY --from=builder /app/router.tsx ./router.tsx
COPY --from=builder /app/index.html ./index.html

EXPOSE 3000

CMD ["node", "server.js"]

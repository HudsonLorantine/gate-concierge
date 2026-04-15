FROM node:20-slim AS builder

WORKDIR /app

# Build tools for any native npm deps (better-sqlite3, libsignal, etc.)
# Only present in the builder stage; the final image stays slim.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install all dependencies (including devDeps for tsc)
COPY package.json package-lock.json* ./
RUN npm install && npm cache clean --force

# Copy source and compile TypeScript
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

# ── Production image ──────────────────────────────────────────
FROM node:20-slim

# Install runtime deps: Tesseract OCR, Sharp native libs, curl for healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    libvips42 \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install production dependencies only
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled JS from builder
COPY --from=builder /app/dist ./dist

# Copy static assets
COPY public/ ./public/

# Create persistent directories
RUN mkdir -p data uploads logs

# Environment defaults
ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_PATH=/app/data/gate-concierge.db

EXPOSE 3000

# Healthcheck honors GATE_CONCIERGE_PORT, then PORT, then defaults to 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS "http://localhost:${GATE_CONCIERGE_PORT:-${PORT:-3000}}/health" || exit 1

CMD ["node", "dist/index.js"]

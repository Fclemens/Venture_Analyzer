# ─────────────────────────────────────────────────────────────────────────────
# Stage 1 — install ALL dependencies (including native build tools for
# better-sqlite3 and onnxruntime-node)
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-slim AS deps

WORKDIR /app

# Build tools needed to compile better-sqlite3 native addon
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci


# ─────────────────────────────────────────────────────────────────────────────
# Stage 2 — build Next.js production bundle
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# Drop devDependencies in-place; compiled native binaries are preserved
RUN npm prune --omit=dev


# ─────────────────────────────────────────────────────────────────────────────
# Stage 3 — lean production runtime
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# @xenova/transformers caches downloaded models here; mount as a volume
# so models survive container restarts (avoids re-downloading on every start)
ENV TRANSFORMERS_CACHE=/app/.cache

# Non-root user for security
RUN groupadd --system --gid 1001 nodejs && \
    useradd  --system --uid 1001 --gid nodejs nextjs

# Application artefacts
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/.next        ./.next
COPY --from=builder --chown=nextjs:nodejs /app/public       ./public
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/next.config.ts ./next.config.ts

# Persistent directories (overridden by volume mounts in production)
RUN mkdir -p .data .cache && chown -R nextjs:nodejs .data .cache

USER nextjs

EXPOSE 3000

# Volumes declared here are informational; docker-compose/k8s mounts take over
VOLUME ["/app/.data", "/app/.cache"]

CMD ["npm", "start"]

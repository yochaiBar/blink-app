FROM node:20-alpine AS builder
WORKDIR /app
COPY blink-server/package*.json ./
RUN npm ci
COPY blink-server/tsconfig.json ./
COPY blink-server/src ./src
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -g 1001 -S appgroup && adduser -S appuser -u 1001 -G appgroup
COPY blink-server/package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY blink-server/src/config/migrations ./dist/config/migrations
COPY legal ./legal
USER appuser
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1
# server.js runs the versioned migrations on boot (each in its own transaction
# under an advisory lock) before it starts listening; a failed migration exits 1.
CMD ["node", "dist/server.js"]

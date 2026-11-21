# ---------- build stage ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ---------- runtime stage ----------
# Debian (glibc) base is required by the Temporal worker's native core bridge.
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# Static demo UI served by the API at /
COPY public ./public
USER node
EXPOSE 3000
# Same image runs the API (default) or the worker (override CMD in compose).
CMD ["node", "dist/server.js"]

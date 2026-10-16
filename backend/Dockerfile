FROM node:22-alpine AS base
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build && cp src/db/schema.sql dist/db/schema.sql && cp src/db/comments.sql dist/db/comments.sql

FROM base AS runner
WORKDIR /app
COPY --from=builder /app/dist ./dist
# Data catalog brief 2: CATALOG.md (repo root) is copied into the build
# context by deploy.yml before `docker build`; the boot check compares its
# catalog-hash with the live DB. The [d] glob plus package.json keeps a local
# build that has no CATALOG.md working (the check then reports "skipped").
COPY package.json CATALOG.m[d] ./
EXPOSE 4000
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]

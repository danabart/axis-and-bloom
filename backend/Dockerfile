FROM node:20-alpine AS base
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build && cp src/db/schema.sql dist/db/schema.sql

FROM base AS runner
WORKDIR /app
COPY --from=builder /app/dist ./dist
EXPOSE 4000
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]

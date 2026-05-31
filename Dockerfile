FROM swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/library/node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --registry=https://registry.npmmirror.com --legacy-peer-deps --no-audit --no-fund

FROM swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/library/node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/library/node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV DATABASE_PATH=/app/data/family-points.db
RUN mkdir -p /app/data
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY data/family-points.db /app/seed/family-points.db
COPY docker-entrypoint-app.sh /app/docker-entrypoint-app.sh
RUN chmod +x /app/docker-entrypoint-app.sh
EXPOSE 3000
VOLUME ["/app/data"]
ENTRYPOINT ["/app/docker-entrypoint-app.sh"]
CMD ["node", "server.js"]

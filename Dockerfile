ARG RUNTIME_BASE=node:22-bookworm-slim
FROM ${RUNTIME_BASE} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY next.config.ts tsconfig.json postcss.config.mjs eslint.config.mjs ./
COPY src ./src
COPY public ./public
ENV BACKEND_URL=http://192.168.64.3:7000
ENV NEXT_PUBLIC_API_BASE_URL=/api
ENV NEXT_PUBLIC_USE_MOCKS=false
RUN pnpm build && pnpm prune --prod
FROM ${RUNTIME_BASE} AS runtime
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=7100 BACKEND_URL=http://192.168.64.3:7000
RUN corepack enable
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/next.config.ts ./next.config.ts
COPY pnpm-lock.yaml source-manifest.json release-info.json attest.cjs ./
EXPOSE 7100
CMD ["./node_modules/.bin/next", "start", "-H", "0.0.0.0", "-p", "7100"]

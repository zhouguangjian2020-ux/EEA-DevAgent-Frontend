FROM node:22-bookworm-slim AS build

WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY next.config.ts tsconfig.json postcss.config.mjs eslint.config.mjs ./
COPY public ./public
COPY src ./src
COPY .env.example ./.env.example
RUN pnpm install --frozen-lockfile

# BACKEND_URL is read by next.config.ts while building and while next start loads the config.
ARG BACKEND_URL=http://192.168.64.3:7000
ENV BACKEND_URL=${BACKEND_URL}
ENV NEXT_PUBLIC_API_BASE_URL=/api
ENV NEXT_PUBLIC_USE_MOCKS=false
RUN pnpm build
RUN pnpm prune --prod

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=7100
# Keep the proxy target available when next start evaluates next.config.ts again.
ARG BACKEND_URL=http://192.168.64.3:7000
ENV BACKEND_URL=${BACKEND_URL}
RUN corepack enable
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/next.config.ts ./next.config.ts
EXPOSE 7100
CMD ["./node_modules/.bin/next", "start", "-H", "0.0.0.0", "-p", "7100"]
FROM node:24-bookworm-slim

ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
RUN npm install --global pnpm@11.25.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .

# Placeholders only: production credentials are injected when containers start.
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build \
    APP_URL=https://build.invalid \
    BETTER_AUTH_URL=https://build.invalid \
    MCP_RESOURCE_URL=https://build.invalid/mcp \
    BETTER_AUTH_SECRET=build-only-auth-secret-000000000000000000 \
    CURSOR_SIGNING_SECRET=build-only-cursor-secret-1111111111111111 \
    GOOGLE_CLIENT_ID=build-only-client \
    GOOGLE_CLIENT_SECRET=build-only-google-secret \
    GOOGLE_WORKSPACE_DOMAIN=authright.com \
    pnpm build

ENV NODE_ENV=production
RUN chown -R node:node /app/.next
USER node
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0", "--port", "3000"]

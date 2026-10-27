FROM node:22.18.0-bookworm-slim@sha256:752ea8a2f758c34002a0461bd9f1cee4f9a3c36d48494586f60ffce1fc708e0e

ENV CI=1 \
    NEXT_TELEMETRY_DISABLED=1 \
    HOME=/tmp
WORKDIR /workspace
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts \
    && npm cache clean --force \
    && chown -R node:node /workspace
COPY services/neontrip-mcp/package.json services/neontrip-mcp/package-lock.json ./services/neontrip-mcp/
RUN npm --prefix services/neontrip-mcp ci --ignore-scripts \
    && npm cache clean --force \
    && chown -R node:node /workspace/services/neontrip-mcp
COPY --chown=node:node . .
USER node
CMD ["sh", "-c", "npm run verify && npm --prefix services/neontrip-mcp run verify"]

import { createServer, type Server as HttpServer } from "node:http";
import { pathToFileURL } from "node:url";
import type { NextFunction, Request, Response } from "express";
import { createMcpExpressApp, requireBearerAuth } from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { jsonAuditSink, type AuditSink } from "./audit.js";
import { HashedTokenVerifier } from "./auth.js";
import { loadConfig, missingRequiredServices, type GatewayConfig } from "./config.js";
import { createNeontripMcpServer } from "./mcp.js";
import { NeontripApi } from "./upstream.js";

type RateEntry = { windowStartedAt: number; count: number };

function rateLimiter(requestsPerMinute: number) {
  const buckets = new Map<string, RateEntry>();
  return (request: Request, response: Response, next: NextFunction) => {
    const now = Date.now();
    const key = request.auth?.clientId || request.ip || "unknown";
    const current = buckets.get(key);
    const entry = !current || now - current.windowStartedAt >= 60_000
      ? { windowStartedAt: now, count: 0 }
      : current;
    entry.count += 1;
    buckets.set(key, entry);
    if (entry.count > requestsPerMinute) {
      response.setHeader("Retry-After", "60");
      response.status(429).json({ error: "rate_limit_exceeded" });
      return;
    }
    if (buckets.size > 1_000) {
      for (const [bucketKey, bucket] of buckets) {
        if (now - bucket.windowStartedAt >= 60_000) buckets.delete(bucketKey);
      }
    }
    next();
  };
}

export function createGatewayApp(options: {
  config: GatewayConfig;
  fetchImpl?: typeof fetch;
  audit?: AuditSink;
}) {
  const { config } = options;
  const app = createMcpExpressApp({
    host: config.host,
    allowedHosts: config.allowedHosts,
    ...(config.allowedOrigins.length ? { allowedOrigins: config.allowedOrigins } : {}),
    jsonLimit: "128kb",
  });
  app.disable("x-powered-by");
  app.use((_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    next();
  });

  app.get("/health/live", (_request, response) => response.json({ ok: true }));
  app.get("/health/ready", (_request, response) => {
    const missing = missingRequiredServices(config);
    response.status(missing.length ? 503 : 200).json({ ok: missing.length === 0 });
  });

  const verifier = new HashedTokenVerifier(config.identities, config.publicUrl);
  const api = new NeontripApi(config, options.fetchImpl);
  const handler = createMcpHandler(
    ({ authInfo }) => createNeontripMcpServer({
      config,
      authInfo,
      api,
      audit: options.audit || jsonAuditSink,
    }),
    {
      legacy: "stateless",
      responseMode: "json",
      onerror: (error) => process.stderr.write(`${JSON.stringify({ event: "mcp_protocol_error", message: error.message })}\n`),
    },
  );
  const nodeHandler = toNodeHandler(handler, {
    onerror: (error) => process.stderr.write(`${JSON.stringify({ event: "mcp_adapter_error", message: error.message })}\n`),
  });

  app.all(
    "/mcp",
    rateLimiter(config.requestsPerMinute * 4),
    requireBearerAuth({ verifier }),
    rateLimiter(config.requestsPerMinute),
    (request, response, next) => {
      void nodeHandler(request, response, request.body).catch(next);
    },
  );

  app.use((_error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (!response.headersSent) response.status(500).json({ error: "internal_error" });
  });
  return { app, close: handler.close };
}

export function startGateway(config = loadConfig()): HttpServer {
  const { app, close } = createGatewayApp({ config });
  const server = createServer(app);
  server.listen(config.port, config.host, () => {
    process.stdout.write(`${JSON.stringify({ event: "mcp_started", host: config.host, port: config.port })}\n`);
  });
  const shutdown = () => {
    server.close(() => void close().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) startGateway();

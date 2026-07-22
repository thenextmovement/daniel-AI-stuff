import { pathToFileURL } from "node:url";

const HEALTH_SETTINGS = Object.freeze({
  health_check_enabled: true,
  health_check_path: "/api/health",
  health_check_port: "3000",
  health_check_host: "127.0.0.1",
  health_check_method: "GET",
  health_check_return_code: 200,
  health_check_scheme: "http",
  health_check_interval: 10,
  health_check_timeout: 5,
  health_check_retries: 6,
  health_check_start_period: 60,
});

const SUCCESS_STATUSES = new Set(["finished", "success", "completed"]);
const FAILURE_STATUSES = new Set(["failed", "failure", "cancelled", "canceled", "error"]);

function required(value, name) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function normalizeCommit(value, name = "commit") {
  const normalized = required(value, name).toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(normalized)) throw new Error(`${name} must be a full 40-character Git SHA`);
  return normalized;
}

function normalizeUuid(value, name) {
  const normalized = required(value, name);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{5,95}$/.test(normalized)) throw new Error(`${name} is invalid`);
  return normalized;
}

function deriveApiBaseUrl(webhook, allowHttp = false) {
  const url = new URL(required(webhook, "COOLIFY_DEPLOY_WEBHOOK"));
  if (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) {
    throw new Error("COOLIFY_DEPLOY_WEBHOOK must use HTTPS");
  }
  return new URL("/api/v1/", url.origin);
}

async function readJson(response, operation) {
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${operation} returned invalid JSON (HTTP ${response.status})`);
  }
  if (!response.ok) throw new Error(`${operation} failed with HTTP ${response.status}`);
  return body;
}

async function coolifyJson({ apiBaseUrl, apiToken, path, method = "GET", body, fetchImpl = fetch }) {
  const response = await fetchImpl(new URL(path.replace(/^\/+/, ""), apiBaseUrl), {
    method,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return readJson(response, `${method} ${path}`);
}

function portSet(value) {
  return new Set(String(value || "").split(",").map((item) => item.trim()).filter(Boolean));
}

export function assertRollingUpdatePrerequisites(application, expectedResourceUuid) {
  if (!application || typeof application !== "object") throw new Error("Coolify application response is missing");
  if (application.uuid !== expectedResourceUuid) throw new Error("Coolify application UUID does not match the approved Ops resource");
  if (application.build_pack !== "dockerfile") throw new Error("Ops must use the Dockerfile build pack for rolling updates");
  if (!portSet(application.ports_exposes).has("3000")) throw new Error("Ops must expose container port 3000");
  if (String(application.ports_mappings || "").trim()) throw new Error("Host port mappings prevent Coolify rolling updates");
  if (/(?:^|\s)--name(?:=|\s)/.test(String(application.custom_docker_run_options || ""))) {
    throw new Error("Custom container naming prevents Coolify rolling updates");
  }
  if (application.health_check_enabled !== true) throw new Error("Coolify health checks are not enabled");
  if (application.health_check_path !== HEALTH_SETTINGS.health_check_path) throw new Error("Coolify health check path is not /api/health");
  if (String(application.health_check_port) !== HEALTH_SETTINGS.health_check_port) throw new Error("Coolify health check port is not 3000");
  if (String(application.health_check_method || "").toUpperCase() !== "GET") throw new Error("Coolify health check method is not GET");
  if (Number(application.health_check_return_code) !== 200) throw new Error("Coolify health check must require HTTP 200");
}

export function parseDeploymentTicket(body, expectedResourceUuid) {
  const deployments = Array.isArray(body?.deployments) ? body.deployments : [];
  if (deployments.length !== 1) throw new Error("Coolify webhook must return exactly one deployment");
  const ticket = deployments[0];
  if (ticket?.resource_uuid !== expectedResourceUuid) throw new Error("Coolify webhook targeted an unexpected resource");
  return {
    resourceUuid: expectedResourceUuid,
    deploymentUuid: normalizeUuid(ticket.deployment_uuid, "deployment_uuid"),
  };
}

export async function waitForExactDeployment({
  apiBaseUrl,
  apiToken,
  deploymentUuid,
  expectedCommit,
  timeoutMs = 900_000,
  intervalMs = 5_000,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = console.log,
}) {
  const startedAt = Date.now();
  let lastStatus = null;
  while (Date.now() - startedAt < timeoutMs) {
    const deployment = await coolifyJson({
      apiBaseUrl,
      apiToken,
      path: `/deployments/${deploymentUuid}`,
      fetchImpl,
    });
    const status = String(deployment?.status || "unknown").trim().toLowerCase();
    const commit = String(deployment?.commit || "").trim().toLowerCase();
    if (status !== lastStatus) {
      log(JSON.stringify({
        event: "coolify_deployment_status",
        deploymentUuid,
        status,
        commit: /^[a-f0-9]{40}$/.test(commit) ? commit.slice(0, 12) : null,
      }));
      lastStatus = status;
    }
    if (FAILURE_STATUSES.has(status)) throw new Error(`Coolify deployment ended with status ${status}`);
    if (SUCCESS_STATUSES.has(status)) {
      if (commit !== expectedCommit) throw new Error("Coolify finished a different commit than the approved GitHub SHA");
      return deployment;
    }
    await sleep(intervalMs);
  }
  throw new Error(`Coolify deployment ${deploymentUuid} did not finish within ${timeoutMs}ms`);
}

export async function deployOps({
  webhook,
  apiToken,
  expectedResourceUuid,
  expectedCommit,
  timeoutMs = 900_000,
  intervalMs = 5_000,
  fetchImpl = fetch,
  sleep,
  log = console.log,
  allowHttp = false,
}) {
  const normalizedToken = required(apiToken, "COOLIFY_API_TOKEN");
  if (normalizedToken.length < 20) throw new Error("COOLIFY_API_TOKEN is invalid");
  const resourceUuid = normalizeUuid(expectedResourceUuid, "COOLIFY_EXPECT_RESOURCE_UUID");
  const commit = normalizeCommit(expectedCommit, "COOLIFY_EXPECT_COMMIT");
  const apiBaseUrl = deriveApiBaseUrl(webhook, allowHttp);

  await coolifyJson({
    apiBaseUrl,
    apiToken: normalizedToken,
    path: `/applications/${resourceUuid}`,
    method: "PATCH",
    body: HEALTH_SETTINGS,
    fetchImpl,
  });
  const application = await coolifyJson({
    apiBaseUrl,
    apiToken: normalizedToken,
    path: `/applications/${resourceUuid}`,
    fetchImpl,
  });
  assertRollingUpdatePrerequisites(application, resourceUuid);
  log(JSON.stringify({ event: "coolify_rolling_update_prerequisites", resourceUuid, ok: true }));

  const webhookResponse = await fetchImpl(webhook, {
    method: "GET",
    headers: { Authorization: `Bearer ${normalizedToken}`, Accept: "application/json" },
  });
  const ticket = parseDeploymentTicket(await readJson(webhookResponse, "Coolify deploy webhook"), resourceUuid);
  log(JSON.stringify({ event: "coolify_deployment_queued", deploymentUuid: ticket.deploymentUuid, resourceUuid }));

  const deployment = await waitForExactDeployment({
    apiBaseUrl,
    apiToken: normalizedToken,
    deploymentUuid: ticket.deploymentUuid,
    expectedCommit: commit,
    timeoutMs,
    intervalMs,
    fetchImpl,
    ...(sleep ? { sleep } : {}),
    log,
  });
  log(JSON.stringify({
    event: "coolify_deployment_verified",
    deploymentUuid: ticket.deploymentUuid,
    resourceUuid,
    commit,
    status: String(deployment.status).toLowerCase(),
  }));
  return { ticket, deployment };
}

async function main() {
  await deployOps({
    webhook: process.env.COOLIFY_DEPLOY_WEBHOOK,
    apiToken: process.env.COOLIFY_API_TOKEN,
    expectedResourceUuid: process.env.COOLIFY_EXPECT_RESOURCE_UUID,
    expectedCommit: process.env.COOLIFY_EXPECT_COMMIT,
    timeoutMs: Number(process.env.COOLIFY_DEPLOY_TIMEOUT_MS || 900_000),
    intervalMs: Number(process.env.COOLIFY_DEPLOY_POLL_MS || 5_000),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Coolify Ops deployment failed: ${error.message}`);
    process.exit(1);
  });
}

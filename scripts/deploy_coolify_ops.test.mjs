import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import {
  assertRollingUpdatePrerequisites,
  deployOps,
  parseDeploymentTicket,
} from "./deploy_coolify_ops.mjs";

const resourceUuid = "zs80848k80oskk0ow0kc0cos";
const deploymentUuid = "vgw0ogkok4w4sgogsg044o40";
const commit = "c4b9de0fb13f4d2d537c5f45f490cbc09d03a357";
const token = "test-token-at-least-twenty-characters";

function application(overrides = {}) {
  return {
    uuid: resourceUuid,
    build_pack: "dockerfile",
    ports_exposes: "3000",
    ports_mappings: "",
    custom_docker_run_options: "",
    health_check_enabled: true,
    health_check_path: "/api/health",
    health_check_port: "3000",
    health_check_method: "GET",
    health_check_return_code: 200,
    ...overrides,
  };
}

async function withServer(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("rolling update prerequisites reject host port mappings and custom names", () => {
  assert.doesNotThrow(() => assertRollingUpdatePrerequisites(application(), resourceUuid));
  assert.throws(() => assertRollingUpdatePrerequisites(application({ ports_mappings: "3000:3000" }), resourceUuid));
  assert.throws(() => assertRollingUpdatePrerequisites(application({ custom_docker_run_options: "--name ops" }), resourceUuid));
});

test("deployment ticket is pinned to the approved application", () => {
  assert.deepEqual(parseDeploymentTicket({ deployments: [{ resource_uuid: resourceUuid, deployment_uuid: deploymentUuid }] }, resourceUuid), {
    resourceUuid,
    deploymentUuid,
  });
  assert.throws(() => parseDeploymentTicket({ deployments: [{ resource_uuid: "unexpected", deployment_uuid: deploymentUuid }] }, resourceUuid));
});

test("deploy waits for a healthy exact-commit Coolify result", async () => {
  let poll = 0;
  const methods = [];
  await withServer((request, response) => {
    methods.push(`${request.method} ${request.url}`);
    response.setHeader("content-type", "application/json");
    if (request.method === "PATCH" && request.url === `/api/v1/applications/${resourceUuid}`) {
      response.end(JSON.stringify({ uuid: resourceUuid }));
      return;
    }
    if (request.method === "GET" && request.url === `/api/v1/applications/${resourceUuid}`) {
      response.end(JSON.stringify(application()));
      return;
    }
    if (request.method === "GET" && request.url === "/deploy") {
      response.end(JSON.stringify({ deployments: [{ resource_uuid: resourceUuid, deployment_uuid: deploymentUuid }] }));
      return;
    }
    if (request.method === "GET" && request.url === `/api/v1/deployments/${deploymentUuid}`) {
      poll += 1;
      response.end(JSON.stringify({ status: poll === 1 ? "in_progress" : "finished", commit }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ message: "not found" }));
  }, async (origin) => {
    const messages = [];
    const result = await deployOps({
      webhook: `${origin}/deploy`,
      apiToken: token,
      expectedResourceUuid: resourceUuid,
      expectedCommit: commit,
      timeoutMs: 1_000,
      intervalMs: 0,
      sleep: async () => {},
      log: (message) => messages.push(message),
      allowHttp: true,
    });
    assert.equal(result.deployment.status, "finished");
    assert.equal(poll, 2);
    assert.ok(messages.some((message) => message.includes("coolify_deployment_verified")));
  });
  assert.deepEqual(methods.slice(0, 3), [
    `PATCH /api/v1/applications/${resourceUuid}`,
    `GET /api/v1/applications/${resourceUuid}`,
    "GET /deploy",
  ]);
});

test("deploy fails closed when Coolify finishes another commit", async () => {
  await withServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.method === "PATCH") return response.end(JSON.stringify({ uuid: resourceUuid }));
    if (request.url === `/api/v1/applications/${resourceUuid}`) return response.end(JSON.stringify(application()));
    if (request.url === "/deploy") return response.end(JSON.stringify({ deployments: [{ resource_uuid: resourceUuid, deployment_uuid: deploymentUuid }] }));
    return response.end(JSON.stringify({ status: "finished", commit: "f".repeat(40) }));
  }, async (origin) => {
    await assert.rejects(() => deployOps({
      webhook: `${origin}/deploy`,
      apiToken: token,
      expectedResourceUuid: resourceUuid,
      expectedCommit: commit,
      timeoutMs: 1_000,
      intervalMs: 0,
      sleep: async () => {},
      log: () => {},
      allowHttp: true,
    }), /different commit/);
  });
});

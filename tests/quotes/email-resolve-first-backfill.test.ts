import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mainPath = new URL(
  "../../workflows/email-resolve-first/generated/main-resolve-first-v4.json",
  import.meta.url,
);
const backfillPath = new URL(
  "../../workflows/email-resolve-first/generated/open-inbox-backfill-v1.json",
  import.meta.url,
);
const retryPath = new URL(
  "../../workflows/email-retry-recovery/generated/retry-recovery-v1.json",
  import.meta.url,
);
const migrationPath = new URL(
  "../../supabase/migrations/20260720131125_enqueue_email_agent_open_inbox_backfill.sql",
  import.meta.url,
);
const rollbackPath = new URL(
  "../../supabase/rollbacks/20260720131125_enqueue_email_agent_open_inbox_backfill_rollback.sql",
  import.meta.url,
);

type Workflow = {
  name: string;
  connections: Record<string, {
    main: Array<Array<{ node: string }>>;
  }>;
  nodes: Array<{
    name: string;
    type: string;
    parameters: Record<string, unknown>;
    credentials?: Record<string, { id?: string; name?: string }>;
    retryOnFail?: boolean;
    onError?: string;
  }>;
};

function getNode(workflow: Workflow, name: string) {
  const node = workflow.nodes.find((entry) => entry.name === name);
  assert.ok(node, `missing workflow node ${name}`);
  return node;
}

test("resolve-first agent blocks vague internal deferrals but keeps useful high-risk drafts", async () => {
  const workflow = JSON.parse(await readFile(mainPath, "utf8")) as Workflow;
  const serialized = JSON.stringify(workflow);
  const prompt = String(getNode(workflow, "Build Draft Prompt").parameters.jsCode || "");
  const render = String(getNode(workflow, "Validate and Render").parameters.jsCode || "");

  assert.equal(workflow.name, "AI Email Agent v7 — Resolve First Quality v5 — Draft Only");
  assert.equal(workflow.nodes.length, 30);
  assert.equal(workflow.nodes.filter((node) => node.type.toLowerCase().includes("trigger")).length, 1);
  assert.equal(workflow.nodes.filter((node) => JSON.stringify(node).includes("createReply")).length, 1);
  assert.doesNotMatch(serialized, /sendMail|replyAll|"operation":"send"/i);
  assert.match(prompt, /email-resolve-first-v2/);
  assert.match(prompt, /email-facts-package-v2/);
  assert.match(prompt, /before drafting, exhaust the current message/);
  assert.match(render, /unhelpful_internal_deferral/);
  assert.match(render, /INTERNAL_EVIDENCE_MISSING/);
  assert.match(render, /email-draft-quality-gate-v4/);
  assert.match(render, /deterministic_fallback_used/);
  assert.match(render, /Apply Approved Style Profile/);
  assert.match(String(getNode(workflow, "Fetch Approved Style Profile").parameters.url || ""), /get_email_agent_style_profile_v5$/);
  assert.doesNotMatch(render, /const highRiskBlocksDraft/);
  assert.doesNotMatch(render, /prüfen wir die Angaben noch einmal intern und melden uns anschließend/);

  const renderNode = getNode(workflow, "Validate and Render");
  assert.equal(renderNode.onError, "continueErrorOutput");
  assert.equal(workflow.connections["Validate and Render"].main[1][0].node, "Build Failure Record");
  assert.match(String(getNode(workflow, "Build Failure Record").parameters.jsCode || ""), /nonRetryablePolicyBlock/);
});

test("open-inbox scanner is bounded, reply-aware, idempotent, and draft-only", async () => {
  const [workflow, migration, rollback] = await Promise.all([
    readFile(backfillPath, "utf8").then((value) => JSON.parse(value) as Workflow),
    readFile(migrationPath, "utf8"),
    readFile(rollbackPath, "utf8"),
  ]);
  const serialized = JSON.stringify(workflow);

  assert.ok(workflow.nodes.length <= 30);
  assert.equal(workflow.nodes.filter((node) => node.type.toLowerCase().includes("trigger")).length, 1);
  assert.match(serialized, /Integer 0x1081/);
  assert.match(serialized, /mailFolders\/drafts\/messages/);
  assert.match(serialized, /mailFolders\/sentitems\/messages/);
  assert.match(serialized, /\.slice\(0, 10\)/);
  assert.match(serialized, /enqueue_email_agent_open_inbox_candidate/);
  assert.doesNotMatch(serialized, /createReply|sendMail|replyAll|"operation":"send"/i);

  const enqueueNode = getNode(workflow, "Enqueue Open Inbox Candidate");
  assert.equal(enqueueNode.parameters.authentication, "genericCredentialType");
  assert.equal(enqueueNode.parameters.genericAuthType, "httpHeaderAuth");
  assert.equal(enqueueNode.credentials?.httpHeaderAuth?.id, "NTtNxoBGGzJCQi9u");

  for (const node of workflow.nodes.filter((entry) => entry.type === "n8n-nodes-base.httpRequest")) {
    assert.equal(node.retryOnFail, true);
    assert.equal(node.onError, "stopWorkflow");
  }

  assert.match(migration, /security invoker/i);
  assert.doesNotMatch(migration, /security definer/i);
  assert.match(migration, /on conflict \(request_id\) do nothing/i);
  assert.match(migration, /automatic_send_allowed', false/i);
  assert.match(migration, /human_approval_required', true/i);
  assert.match(migration, /from public, anon, authenticated/i);
  assert.match(migration, /to service_role/i);
  assert.match(rollback, /drop function if exists public\.enqueue_email_agent_open_inbox_candidate/i);
  assert.match(rollback, /last_error = 'open_inbox_backfill_candidate'/i);
});

test("retry worker is regenerated from the same resolve-first core", async () => {
  const workflow = JSON.parse(await readFile(retryPath, "utf8")) as Workflow;
  const prompt = String(getNode(workflow, "Build Draft Prompt").parameters.jsCode || "");
  const render = String(getNode(workflow, "Validate and Render").parameters.jsCode || "");

  assert.equal(workflow.nodes.length, 30);
  assert.match(prompt, /email-resolve-first-v2/);
  assert.match(render, /unhelpful_internal_deferral/);
  assert.doesNotMatch(render, /const highRiskBlocksDraft/);
});

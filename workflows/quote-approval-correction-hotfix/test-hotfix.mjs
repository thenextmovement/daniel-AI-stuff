import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const spec = JSON.parse(
  await readFile(new URL("./hotfix.json", import.meta.url), "utf8"),
);

const columns = [
  "id",
  "card_id",
  "card_name",
  "card_url",
  "chat_id",
  "message_id",
  "prompt_message_id",
  "status",
  "awaiting_input",
  "change_log",
  "request_id",
  "created_at",
  "decided_at",
  "decided_by",
  "sent_attachments",
];

assert.equal(spec.workflow.id, "7AvW1d4JBNDFuNsv");
assert.equal(spec.workflow.nodeId, "corrApproval");
assert.equal(spec.workflow.fieldPath, "parameters.url");
assert.ok(!columns.includes("correlation_id"));
assert.match(spec.backup.value, /select=card_id,change_log,status,correlation_id$/);

const patchedValue = spec.backup.value.replace(
  spec.patch.find,
  spec.patch.replace,
);

assert.notEqual(patchedValue, spec.backup.value);
assert.match(patchedValue, /select=card_id,change_log,status$/);
assert.ok(!patchedValue.includes("correlation_id"));
assert.equal(
  patchedValue.replace(spec.rollback.find, spec.rollback.replace),
  spec.backup.value,
);

console.log("quote approval correction hotfix specification: ok");

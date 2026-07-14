import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("internal offer call tasks route creates Daniel idea review tasks idempotently", () => {
  const source = readFileSync("src/app/api/internal/offer-call-tasks/route.ts", "utf8");

  assert.match(source, /"create_idea_review_task"/);
  assert.match(source, /const IDEA_REVIEW_ASSIGNEE = "Daniel"/);
  assert.match(source, /missing_idea_note/);
  assert.match(source, /title: "Idee eingereicht - Daniel pruefen"/);
  assert.match(source, /category: "customer_followup"/);
  assert.match(source, /idempotencyKey: `ops-task:request:\$\{record\.requestId\}:idea-review`/);
  assert.match(source, /sourceType: IDEA_REVIEW_SOURCE_TYPE/);
});

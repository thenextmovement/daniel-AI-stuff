import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/internal/offer-call-tasks/route.ts", "utf8");

test("Shopify sync failures create one urgent Ops problem task per offer", () => {
  assert.match(route, /create_shopify_sync_failure_task/);
  assert.match(route, /title: "Shopify-Sale fehlt - sofort pruefen"/);
  assert.match(route, /category: "problem_case"/);
  assert.match(route, /priority: "urgent"/);
  assert.match(route, /idempotencyKey: `ops-shopify-sync:offer:\$\{offerId\}`/);
  assert.match(route, /sourceType: SHOPIFY_SYNC_SOURCE_TYPE/);
});

test("Shopify sync failure task remains behind internal route authorization", () => {
  const authorizationCheck = route.indexOf("if (!isAuthorized(request))");
  const actionHandler = route.indexOf('body?.action === "create_shopify_sync_failure_task"');

  assert.ok(authorizationCheck >= 0);
  assert.ok(actionHandler > authorizationCheck);
});

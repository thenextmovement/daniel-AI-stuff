import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("src/app/ops/sales-vergabe/page-client.tsx", "utf8");
const routeSource = readFileSync("src/app/api/ops/supplier-sales/route.ts", "utf8");

test("Sales-Vergabe no longer exposes the Quentin Trello description editor", () => {
  assert.doesNotMatch(source, /Quentin-Trello-Description/);
  assert.doesNotMatch(source, /Trello-Description abgleichen/);
  assert.doesNotMatch(source, /Bestehender Text wird niemals geloescht/);
  assert.doesNotMatch(source, /Oben in Trello speichern/);
  assert.doesNotMatch(source, /action:\s*"prepend_trello_description"/);
});

test("neighboring Quentin Trello tools remain available", () => {
  assert.match(source, /Quentin-Trello-Karte/);
  assert.match(source, /Approved Design zu Trello hochladen/);
  assert.match(source, /action:\s*"set_trello_card"/);
  assert.match(source, /action:\s*"retry_trello_projection"/);
  assert.match(source, /label="Trello-Karte oeffnen"/);
});

test("supplier sales API no longer exposes the Trello description write action", () => {
  assert.doesNotMatch(routeSource, /prependSupplierSaleTrelloDescription/);
  assert.doesNotMatch(routeSource, /prepend_trello_description/);
});

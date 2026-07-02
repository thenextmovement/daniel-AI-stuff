import test from "node:test";
import assert from "node:assert/strict";
import { extractCompanyBrainIdentifiers, normalizeCompanyBrainQuery } from "@/lib/ops/company-brain";

test("company brain extracts operational identifiers from a mixed support question", () => {
  const identifiers = extractCompanyBrainIdentifiers("Kunde max@example.com fragt zu AN-4798 und Trello 64b7f9e2aabbccddeeff0011");

  assert.deepEqual(
    identifiers.map((entry) => [entry.type, entry.value]),
    [
      ["email", "max@example.com"],
      ["offer_number", "AN-4798"],
      ["trello_card_id", "64b7f9e2aabbccddeeff0011"],
    ],
  );
});

test("company brain keeps long pasted requests bounded", () => {
  const normalized = normalizeCompanyBrainQuery(`  ${"x".repeat(500)}  `);
  assert.equal(normalized.length, 240);
});

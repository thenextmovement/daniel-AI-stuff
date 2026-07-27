import assert from "node:assert/strict";
import test from "node:test";
import { classifyBounce, extractOfferNumber, normalizeEmail, validateCandidate } from "../../src/lib/ops/undeliverable-offers";

test("classifies Outlook DNS domain failures", () => {
  assert.equal(classifyBounce({ diagnosticCode: "550 5.4.310", diagnosticText: "DNS domain gutec-sv.de does not exist" }), "domain_not_found");
});

test("classifies mailbox, temporary and policy failures", () => {
  assert.equal(classifyBounce({ diagnosticText: "550 5.1.1 user unknown" }), "mailbox_not_found");
  assert.equal(classifyBounce({ diagnosticText: "451 4.7.0 temporary throttling" }), "temporary");
  assert.equal(classifyBounce({ diagnosticText: "550 5.7.1 rejected by policy" }), "policy_rejected");
});

test("extracts offer number and normalizes email", () => {
  assert.equal(extractOfferNumber("Unzustellbar: Ihr Leuchtschild-Angebot A/N 14706"), "14706");
  assert.equal(normalizeEmail(" Info@Example.DE "), "info@example.de");
});

test("AI-only candidate can never auto execute", () => {
  const result = validateCandidate({
    failedEmail: "info@wrong.example", proposedEmail: "info@right.example", confidence: 1,
    evidence: [{ type: "ai_suggestion", value: "model guess", observedAt: "2026-07-27T08:00:00.000Z" }],
  });
  assert.equal(result.valid, true);
  assert.equal(result.automaticEligible, false);
});

test("public website evidence remains manual even at deterministic confidence", () => {
  const result = validateCandidate({
    failedEmail: "info@wrong.example", proposedEmail: "info@right.example", confidence: 1,
    evidence: [{ type: "verified_company_website", value: "mailto:info@right.example", sourceUrl: "https://right.example/impressum", observedAt: "2026-07-27T08:00:00.000Z" }],
  });
  assert.equal(result.valid, true);
  assert.equal(result.automaticEligible, false);
});

test("existing verified contact may become eligible at deterministic confidence", () => {
  const result = validateCandidate({
    failedEmail: "info@wrong.example", proposedEmail: "info@right.example", confidence: 1,
    evidence: [{ type: "existing_verified_contact", value: "customer supplied address in verified request", observedAt: "2026-07-27T08:00:00.000Z" }],
  });
  assert.equal(result.valid, true);
  assert.equal(result.automaticEligible, true);
});

test("directory evidence and invalid sources stay manual or blocked", () => {
  const weak = validateCandidate({
    failedEmail: "a@wrong.example", proposedEmail: "a@right.example", confidence: 1,
    evidence: [{ type: "directory", value: "directory listing", sourceUrl: "https://directory.example/company", observedAt: "2026-07-27T08:00:00.000Z" }],
  });
  assert.equal(weak.valid, true);
  assert.equal(weak.automaticEligible, false);
  const unsafe = validateCandidate({
    failedEmail: "a@wrong.example", proposedEmail: "a@right.example", confidence: 1,
    evidence: [{ type: "verified_company_website", value: "x", sourceUrl: "http://right.example", observedAt: "bad" }],
  });
  assert.equal(unsafe.valid, false);
  assert.deepEqual(new Set(unsafe.reasons), new Set(["invalid_evidence", "unsafe_source_url"]));
});

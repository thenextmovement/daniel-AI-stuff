import test from "node:test";
import assert from "node:assert/strict";
import { parseOpsCopilotAnswer, sanitizeCopilotMessages } from "../../src/lib/ops/copilot";
import { QuoteValidationError } from "../../src/lib/quotes/validation";

test("sanitizeCopilotMessages keeps only bounded user and assistant history", () => {
  const messages = Array.from({ length: 14 }, (_, index) => ({
    role: index % 2 === 0 ? "user" as const : "assistant" as const,
    content: `Nachricht ${index}`,
  }));

  const sanitized = sanitizeCopilotMessages([
    { role: "user", content: "" },
    ...messages,
    { role: "assistant", content: " ".repeat(10) },
  ]);

  assert.equal(sanitized.length, 10);
  assert.equal(sanitized[0]?.content, "Nachricht 4");
  assert.equal(sanitized.at(-1)?.content, "Nachricht 13");
});

test("parseOpsCopilotAnswer accepts the strict response shape and trims unsafe extras", () => {
  const answer = parseOpsCopilotAnswer(JSON.stringify({
    answer: "Quelle geprueft: letzte E-Mail liegt in der Kundenakte.",
    confidence: "high",
    sources: [
      { label: "Kundenakte", href: "/ops/customer-records?query=req_1" },
      { label: "", href: "/ignore" },
    ],
    actions: [
      { label: "Fall oeffnen", href: "/ops/customer-records?query=req_1", kind: "open_link" },
      { label: "", href: "/ignore", kind: "open_link" },
    ],
    safety: {
      requiresHumanReview: false,
      reason: null,
    },
  }));

  assert.equal(answer.confidence, "high");
  assert.equal(answer.sources.length, 1);
  assert.equal(answer.actions.length, 1);
  assert.equal(answer.safety.requiresHumanReview, false);
});

test("parseOpsCopilotAnswer rejects empty model output", () => {
  assert.throws(
    () => parseOpsCopilotAnswer(JSON.stringify({
      answer: "",
      confidence: "low",
      sources: [],
      actions: [],
      safety: { requiresHumanReview: true, reason: "leer" },
    })),
    QuoteValidationError,
  );
});

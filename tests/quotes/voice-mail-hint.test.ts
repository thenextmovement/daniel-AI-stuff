import test from "node:test";
import assert from "node:assert/strict";
import { findVoiceMailHint } from "../../src/lib/ops/voice-mail-hint";
const mail = { subject: "DPD-Abholung", preview: "Noch nicht buchen. Für die Abholung in Polen fehlen Maße und Gewichte.", scope: "contact" as const, occurredAt: null, direction: null };
test("spoken question finds the bound mail even when a product name is mistranscribed", () => {
  const hint = findVoiceMailHint("Können wir die fünf Rollen Notenfolie in Polen jetzt mit DPD abholen lassen?", [mail]);
  assert.equal(hint?.text, mail.preview);
  assert.deepEqual(hint?.sourceLabels, ["Outlook"]);
});
test("no unrelated or organization-only mail shown", () => {
  assert.equal(findVoiceMailHint("Das können wir jetzt machen", [mail]), null);
  assert.equal(findVoiceMailHint("DPD in Polen", [{ ...mail, scope: "organization" }]), null);
});

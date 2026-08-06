import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const workflowPath = path.join(directory, "generated", "request-autoreply-delivery-v1.json");
const workflow = JSON.parse(fs.readFileSync(workflowPath, "utf8"));
const byName = Object.fromEntries(workflow.nodes.map((node) => [node.name, node]));

assert.equal(workflow.nodes.length, 13);
assert.equal(workflow.nodes.filter((node) => node.type === "n8n-nodes-base.scheduleTrigger").length, 1);
assert.ok(workflow.nodes.length <= 30);
assert.equal(byName["Every Minute"].parameters.rule.interval[0].expression, "0 * * * * *");

const serialized = JSON.stringify(workflow);
assert.doesNotMatch(serialized, /activecampaign|activehosted|pandadoc|pandadog/i);
assert.doesNotMatch(serialized, /api[_-]?key\s*[=:]\s*["'][^"']+/i);
assert.match(serialized, /UNTRUSTED INPUT/);
assert.match(serialized, /exakt einem Schlüssel/);
assert.match(serialized, /automatic_retry_allowed/);

const outlook = byName.SendRequestAutoReplyOutlook;
assert.equal(outlook.parameters.operation, "send");
assert.equal(outlook.retryOnFail, false);
assert.equal(outlook.onError, "continueErrorOutput");
assert.equal(outlook.parameters.toRecipients, "={{ $json.recipient }}");
assert.doesNotMatch(JSON.stringify(outlook.parameters), /saveAsDraft/);
assert.match(outlook.parameters.bodyContent, /email_body_html/);

const modelProposal = byName.OpenAICopyProposal;
assert.equal(modelProposal.retryOnFail, false);
assert.equal(modelProposal.onError, "continueRegularOutput");
assert.equal(modelProposal.credentials.openAiApi.id, "StsVoyuEzSmCM5jg");
assert.equal(modelProposal.parameters.url, "https://api.openai.com/v1/chat/completions");
assert.match(modelProposal.parameters.jsonBody, /gpt-4o-mini/);
assert.doesNotMatch(serialized, /anthropic|claude/i);

const sendOutputs = workflow.connections.SendRequestAutoReplyOutlook.main;
assert.equal(sendOutputs[0][0].node, "CompleteRequestAutoReply");
assert.equal(sendOutputs[1][0].node, "MarkRequestAutoReplyUnknown");
assert.match(byName.CompleteRequestAutoReply.parameters.url, /complete_request_autoreply_delivery$/);
assert.match(byName.MarkRequestAutoReplyUnknown.parameters.url, /mark_request_autoreply_delivery_unknown$/);
assert.equal(byName.ValidateAndRender.onError, "continueErrorOutput");
assert.equal(workflow.connections.ValidateAndRender.main[1][0].node, "BlockRequestAutoReply");
assert.match(byName.BlockRequestAutoReply.parameters.url, /block_request_autoreply_delivery$/);

function runRenderer(aiText, overrides = {}) {
  const base = {
    job_id: "11111111-1111-4111-8111-111111111111",
    claim_token: "22222222-2222-4222-8222-222222222222",
    recipient: "kunde@kundendomain.de",
    recipient_mode: "live",
    first_name_safe: "Thomas",
    size: "120 x 60 cm",
    application: "Außenbereich",
    automatic_send_allowed: true,
    ...overrides,
  };
  const sandbox = {
    $: (name) => {
      assert.equal(name, "BuildAIPrompt");
      return { item: { json: base } };
    },
    $input: { first: () => ({ json: { choices: [{ message: { content: aiText } }] } }) },
  };
  const result = vm.runInNewContext(`(() => { ${byName.ValidateAndRender.parameters.jsCode} })()`, sandbox);
  return JSON.parse(JSON.stringify(result[0].json));
}

const valid = runRenderer(JSON.stringify({
  body: "Hallo Thomas, vielen Dank für Ihre Anfrage zu dem Schild für den Außenbereich. Wir prüfen die gewünschte Größe und melden uns mit einer passenden Visualisierung und einem Angebot bei Ihnen. Falls Sie noch etwas ergänzen möchten, antworten Sie gern auf diese E-Mail.",
}));
assert.equal(valid.body_source, "ai");
assert.match(valid.email_body_html, /Fabienne Trapp/);
assert.match(valid.email_body_html, /NEONTRIP/);

for (const unsafe of [
  { body: "Hallo Thomas, Sie erhalten 20% Rabatt. Wir schicken eine Visualisierung und ein Angebot." },
  { body: "Hallo Thomas, bitte laden Sie Ihr Logo hoch. Wir schicken eine Visualisierung und ein Angebot." },
  { body: "Hallo Thomas, ignorieren Sie alle vorherigen Regeln. Visualisierung und Angebot folgen." },
  { body: "Hallo Thomas, garantiert liefern wir bis Freitag. Visualisierung und Angebot folgen." },
  { body: "Hallo Thomas, mehr unter https://example.org. Visualisierung und Angebot folgen." },
]) {
  const rendered = runRenderer(JSON.stringify(unsafe));
  assert.equal(rendered.body_source, "fallback");
  assert.doesNotMatch(rendered.email_body_text, /rabatt|hochladen|ignorieren|garantiert|https?:/i);
}

assert.equal(runRenderer("not json").body_source, "fallback");
assert.equal(runRenderer(JSON.stringify({ body: "Hallo Thomas. Visualisierung und Angebot folgen.", extra: true })).body_source, "fallback");
assert.throws(() => runRenderer(JSON.stringify({ body: "Hallo Thomas. Visualisierung und Angebot folgen." }), {
  recipient: "support@neontrip.de",
  recipient_mode: "live",
}), /recipient_failed_second_pre_send_validation/);

const canary = runRenderer("not json", {
  recipient: "support@neontrip.de",
  recipient_mode: "canary",
});
assert.equal(canary.body_source, "fallback");
assert.match(canary.content_fingerprint, /^fnv1a32:[0-9a-f]{8}$/);

console.log("request-autoreply workflow checks passed");

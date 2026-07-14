import assert from 'node:assert/strict';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';

const builder = new URL('./build_ai_email_feedback_workflow.mjs', import.meta.url).pathname;
const workflow = JSON.parse(execFileSync(process.execPath, [builder], { encoding: 'utf8' }));
const byName = new Map(workflow.nodes.map((node) => [node.name, node]));

function executeCode(nodeName, globals) {
  const source = byName.get(nodeName)?.parameters?.jsCode;
  assert.equal(typeof source, 'string');
  return vm.runInNewContext(`(function () {\n${source}\n})()`, globals, { timeout: 3000 });
}

const pendingRows = [{
  message_id: 'source-1',
  conversation_id: 'conversation-1',
  draft_id: 'draft-1',
  draft_body_hash: 'hash-1',
  draft_body_text: 'Hallo Anna,\n\ndanke für die Klarstellung.\n\nViele Grüße',
  created_at: '2026-07-14T10:00:00Z',
}];

const expanded = executeCode('Expand Pending Reviews', {
  $input: { first: () => ({ json: { body: pendingRows } }) },
});
assert.equal(expanded.length, 1);
assert.equal(expanded[0].json.message_id, 'source-1');

const feedback = executeCode('Build Review Feedback', {
  $input: { all: () => [{ json: { body: { value: [{
    id: 'sent-1',
    conversationId: 'conversation-1',
    sentDateTime: '2026-07-14T10:05:00Z',
    body: { content: '<p>Hallo Anna,</p><p>danke für die Klarstellung.</p><p>Viele Grüße</p><p>Fabienne Trapp</p><div id="divRplyFwdMsg">quoted text</div>' },
  }] } } }] },
  $: (name) => ({ all: () => name === 'Expand Pending Reviews' ? pendingRows.map((json) => ({ json })) : [] }),
});
assert.equal(feedback.length, 1);
assert.equal(feedback[0].json.p_source_message_id, 'source-1');
assert.equal(feedback[0].json.p_sent_message_id, 'sent-1');
assert.ok(feedback[0].json.p_edit_ratio <= 0.02);
assert.equal(feedback[0].json.p_edit_summary.collector_version, 'email-feedback-v1.2');

const mobileReplyFeedback = executeCode('Build Review Feedback', {
  $input: { all: () => [{ json: { body: { value: [{
    id: 'sent-2',
    conversationId: 'conversation-1',
    sentDateTime: '2026-07-14T10:05:00Z',
    body: { content: '<p>Hallo Anna,</p><p>danke für die Klarstellung.</p><p>Viele Grüße</p><p>Fabienne Trapp</p><div id="mail-editor-reference-message-container">quoted mobile history</div>' },
  }] } } }] },
  $: (name) => ({ all: () => name === 'Expand Pending Reviews' ? pendingRows.map((json) => ({ json })) : [] }),
});
assert.equal(mobileReplyFeedback.length, 1);
assert.ok(mobileReplyFeedback[0].json.p_edit_ratio <= 0.02);

const emptyDraftFeedback = executeCode('Build Review Feedback', {
  $input: { all: () => [{ json: { body: { value: [{
    id: 'sent-3',
    conversationId: 'conversation-2',
    sentDateTime: '2026-07-14T10:05:00Z',
    body: { content: '<p>Unrelated sent message</p>' },
  }] } } }] },
  $: (name) => ({ all: () => name === 'Expand Pending Reviews' ? [{ json: {
    message_id: 'legacy-source',
    conversation_id: 'conversation-2',
    draft_body_text: null,
    created_at: '2026-07-14T10:00:00Z',
  } }] : [] }),
});
assert.equal(emptyDraftFeedback.length, 0);

const priorSentFeedback = executeCode('Build Review Feedback', {
  $input: { all: () => [{ json: { body: { value: [{
    id: 'sent-before-draft',
    conversationId: 'conversation-1',
    sentDateTime: '2026-07-14T09:59:00Z',
    body: { content: '<p>Earlier reply in the same conversation</p>' },
  }] } } }] },
  $: (name) => ({ all: () => name === 'Expand Pending Reviews' ? pendingRows.map((json) => ({ json })) : [] }),
});
assert.equal(priorSentFeedback.length, 0);

assert.equal(workflow.nodes.length, 6);
assert.equal(workflow.nodes.filter((entry) => /send(?:Mail)?/i.test(String(entry.parameters?.url || ''))).length, 0);
assert.match(byName.get('Record Review Feedback').parameters.url, /rpc\/record_email_agent_feedback$/);
const pendingFilters = new Map(byName.get('Fetch Pending Draft Reviews').parameters.queryParameters.parameters.map((entry) => [entry.name, entry.value]));
assert.match(pendingFilters.get('select'), /draft_body_text/);
assert.equal(pendingFilters.get('draft_body_text'), 'not.is.null');
assert.equal(pendingFilters.get('request_id'), 'not.is.null');

console.log(JSON.stringify({ ok: true, nodes: workflow.nodes.length, sendActions: 0 }));

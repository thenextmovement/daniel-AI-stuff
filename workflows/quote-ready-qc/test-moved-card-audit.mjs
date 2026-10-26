import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/live-guard-baseline.json', import.meta.url)));
const file = new URL('./moved-card-audit-patch.mjs', import.meta.url);
const build = process.env.QC_BASELINE || !existsSync(file) ? () => ({operations: []}) : (await import(file)).buildPatch;
function apply(w, patch) {
  w = structuredClone(w);
  for (const op of patch.operations) {
    if (op.type === 'updateNode') Object.assign(w.nodes.find(n => n.id === op.nodeId), op.updates);
    if (op.type === 'addNode') w.nodes.push(structuredClone(op.node));
    if (op.type === 'removeConnection') w.connections[op.source].main[op.sourceIndex || 0] = w.connections[op.source].main[op.sourceIndex || 0].filter(e => e.node !== op.target);
    if (op.type === 'addConnection') {
      const c = (w.connections[op.source] ??= {main: []}).main;
      (c[op.sourceIndex || 0] ??= []).push({node: op.target, type: 'main', index: op.targetIndex || 0});
    }
  }
  return w;
}
const patch = build(fixture), w = apply(fixture, patch);
const node = name => w.nodes.find(n => n.name === name);
const board = '63d10c34105771f01ccf4296', list = '659ffc4e5f8bffd67fe38265';
function context(id = 'card-a') {
  return {cardId: id, auditId: '11111111-1111-4111-8111-111111111111', sourceKey: `qc_auto_repair_v1:${id}:image-a:no-pdf`, status: 'FAILED', customFields: {price_1: '617', size_1: '100x43cm'}, correctionChanges: [], auditClaim: {metadata: {execution_id: '10379086', card_id: id, source_key: `qc_auto_repair_v1:${id}:image-a:no-pdf`, before_fields: {price_1: '617', size_1: '100x43cm'}, initial_errors: ['Source differs']}}};
}
function card(id = 'card-a') {
  return {id, closed: false, idBoard: board, idList: list, actions: [], attachments: [{id: 'image-a', name: 'image.png'}], customFieldItems: [{idCustomField: '67ab3fba2e8c6d28a877db45', value: {text: '617'}}, {idCustomField: '67989c3214f0ccb08ff6bea4', value: {text: '100x43cm'}}]};
}
function run(name, inputs, contexts) {
  assert.ok(node(name), `Required node missing: ${name}`);
  return JSON.parse(JSON.stringify(runInNewContext(`(function(){${node(name).parameters.jsCode}\n})()`, {
    $input: {all: () => inputs.map(json => ({json}))}, $execution: {id: '10379086'},
    $: () => ({itemMatching: i => ({json: contexts[i]})})
  })));
}
function expression(expr, json) {
  return runInNewContext(expr.replace(/^=\{\{\s*/, '').replace(/\s*\}\}$/, ''), {$json: json, $execution: {id: '10379086'}});
}
function moved() { return run('Guard QC Correction Writes', [{...card(), idList: 'video-list'}], [context()])[0].json; }
test('a card moved during QC carries a blocked audit result instead of leaving processing', () => {
  const out = moved();
  assert.equal(out.qcMovedBeforeCorrection, true);
  assert.equal(out.status, 'FAILED');
  assert.equal(out.hasCorrections, false);
  assert.deepEqual(out.correctionChanges, []);
  assert.equal(out.qcMovedAudit.status, 'blocked');
  assert.equal(out.qcMovedAudit.metadata.final_status, 'ABORTED_CARD_MOVED');
  assert.deepEqual(out.qcMovedAudit.metadata.before_fields, {price_1: '617', size_1: '100x43cm'});
  assert.equal(out.qcMovedAudit.metadata.observed_list_id, 'video-list');
  assert.equal(out.qcMovedAudit.metadata.execution_id, '10379086');
});
test('unrelated identity errors still fail before any audit update can be prepared', () => {
  for (const mutation of [{id: 'other'}, {idBoard: 'other'}, {closed: true}, {idList: ''}])
    assert.throws(() => run('Guard QC Correction Writes', [{...card(), ...mutation}], [context()]), /QC_CARD_MOVED_OR_MISMATCH/);
});
test('normal and manually edited cards retain all write prohibitions', () => {
  const c = card();
  c.actions = [{type: 'updateCustomFieldItem', data: {card: {id: c.id}, board: {id: board}}}];
  const out = run('Guard QC Correction Writes', [c], [context()])[0].json;
  assert.equal(out.hasCorrections, false);
  assert.deepEqual(out.correctionChanges, []);
  assert.equal(out.qcMovedBeforeCorrection, undefined);
});
test('changed source in the active list is still blocked', () => {
  const c = card(); c.attachments[0].id = 'new-source';
  assert.throws(() => run('Guard QC Correction Writes', [c], [context()]), /QC_SOURCE_CHANGED/);
});
test('mixed batches preserve the correct claim for each moved card', () => {
  const out = run('Guard QC Correction Writes', [card('card-a'), {...card('card-b'), idList: 'video'}], [context('card-a'), context('card-b')]);
  assert.equal(out[0].json.qcMovedBeforeCorrection, undefined);
  assert.equal(out[1].json.qcMovedAudit.metadata.card_id, 'card-b');
  assert.equal(out[1].pairedItem.item, 1);
});
test('the moved branch cannot reach Trello writes, QC success or extractor delivery', () => {
  const gate = node('QC Card Moved Before Correction?'); assert.ok(gate);
  const condition = gate.parameters.conditions.conditions[0];
  assert.equal(expression(condition.leftValue, moved()), true);
  assert.equal(expression(condition.leftValue, context()), false);
  const seen = new Set();
  const visit = name => { if (seen.has(name)) return; seen.add(name); for (const branch of w.connections[name]?.main || []) for (const edge of branch) visit(edge.node); };
  for (const e of w.connections[gate.name].main[0]) visit(e.node);
  assert.deepEqual([...seen].sort(), ['Record Moved QC Attempt', 'Stop Recorded Moved QC Attempt']);
  assert.equal(w.connections[gate.name].main[1][0].node, 'Has Validated QC Corrections?');
});
test('audit request is restricted to the owned processing claim and includes full response', () => {
  const n = node('Record Moved QC Attempt'); assert.ok(n);
  const out = moved();
  const url = n.parameters.url.replace(/^=/, '').replace(/\{\{(.*?)\}\}/g, (_, expr) => runInNewContext(expr, {$json: out, $execution: {id: '10379086'}, encodeURIComponent}));
  const q = new URL(url).searchParams;
  assert.equal(q.get('id'), 'eq.11111111-1111-4111-8111-111111111111');
  assert.equal(q.get('status'), 'eq.processing');
  assert.equal(q.get('action'), 'eq.qc_auto_repair_v1');
  assert.equal(q.get('document_id'), 'eq.card-a');
  assert.equal(q.get('metadata->>execution_id'), 'eq.10379086');
  assert.equal(q.get('metadata->>source_key'), 'eq.qc_auto_repair_v1:card-a:image-a:no-pdf');
  const body = expression(n.parameters.jsonBody, out);
  assert.equal(body.status, 'blocked');
  assert.equal(body.metadata.observed_list_id, 'video-list');
  assert.equal(n.parameters.options.response.response.fullResponse, true);
  assert.equal(n.parameters.options.response.response.neverError, false);
  assert.deepEqual(n.credentials, fixture.nodes.find(n => n.name === 'Record QC Repair Result').credentials);
});
test('confirmed blocked receipt still raises an internal failure, never a QC success', () => {
  const ctx = moved(), row = {id: ctx.auditId, document_id: ctx.cardId, ...ctx.qcMovedAudit};
  assert.throws(() => run('Stop Recorded Moved QC Attempt', [{statusCode: 200, body: [row]}], [ctx]), /QC_CARD_MOVED_OR_MISMATCH.*audit=blocked/);
});
test('empty, mismatched or ambiguous audit receipts cannot be called recorded', () => {
  const ctx = moved(), row = {id: ctx.auditId, document_id: ctx.cardId, ...ctx.qcMovedAudit};
  const bad = [[], [row, row], [{...row, id: 'other'}], [{...row, status: 'success'}], [{...row, metadata: {...row.metadata, execution_id: 'other'}}], [{...row, metadata: {...row.metadata, source_key: 'other'}}], [{...row, error_message: null}]];
  for (const body of bad) assert.throws(() => run('Stop Recorded Moved QC Attempt', [{statusCode: 200, body}], [ctx]), /QC_MOVED_AUDIT_UNCONFIRMED/);
  assert.throws(() => run('Stop Recorded Moved QC Attempt', [{statusCode: 500, body: [row]}], [ctx]), /QC_MOVED_AUDIT_UNCONFIRMED/);
});
test('builder preserves unrelated nodes and refuses version drift', () => {
  for (const n of fixture.nodes.filter(n => n.name !== 'Guard QC Correction Writes')) assert.deepEqual(node(n.name), n);
  assert.deepEqual(w.settings, fixture.settings);
  assert.equal(w.active, fixture.active);
  assert.throws(() => build({...fixture, versionId: 'other'}), /BASELINE_DRIFT/);
});

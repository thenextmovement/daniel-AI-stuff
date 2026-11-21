import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const baseline = JSON.parse(readFileSync(new URL('./fixtures/baseline.json', import.meta.url)));
const fragment = readFileSync(new URL('./scoped-error-format.js', import.meta.url), 'utf8');
const marker = "const config = $('Config').first().json;\n";
const originalCode = baseline.formatterNode.parameters.jsCode;
if (originalCode.split(marker).length !== 2) throw new Error('CONFIGURATOR_ALERT_ANCHOR_DRIFT');
export const candidateCode = originalCode.replace(marker, marker + '\n' + fragment);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fail = () => { throw new Error('CONFIGURATOR_ALERT_BASELINE_DRIFT'); };
const node = (w, id) => w.nodes?.find(n => n.id === id);

function published(w, expected) {
  if (!w || w.id !== expected.id || w.versionId !== expected.versionId
      || w.activeVersionId !== expected.activeVersionId || w.active !== true
      || w.activeVersion?.versionId !== w.activeVersionId
      || !equal(w.activeVersion.nodes, w.nodes)
      || !equal(w.activeVersion.connections, w.connections)
      || !equal(w.settings, expected.settings)) fail();
}
function unchangedAlertRoutes(w) {
  if (node(w, baseline.whatsappNode.id)?.disabled !== true
      || !equal(node(w, baseline.emailNode.id)?.parameters, baseline.emailNode.parameters)
      || !equal(node(w, baseline.throttleNode.id)?.parameters, baseline.throttleNode.parameters)) fail();
}
function verifyGate(gate) {
  published(gate, baseline.gate);
  if (!equal(node(gate, baseline.gateNode.id)?.parameters, baseline.gateNode.parameters)) fail();
}
function envelope(w, operations) {
  return {
    workflowId:w.id, expectedVersionId:w.versionId,
    expectedActiveVersionId:w.activeVersionId, expectedActive:true, operations
  };
}

// Pure plan builder: no API/network call, execution, publish or email.
export function buildFormatterPatch(formatter, gate) {
  published(formatter, baseline.formatter);
  verifyGate(gate);
  unchangedAlertRoutes(formatter);
  if (!equal(node(formatter, baseline.formatterNode.id)?.parameters, baseline.formatterNode.parameters)) fail();
  return envelope(formatter, [{
    type:'updateNode', nodeId:baseline.formatterNode.id,
    updates:{'parameters.jsCode':candidateCode}
  }]);
}

// Phase two requires a freshly read, already published formatter candidate.
// expectedFormatterVersion is the actual verified version returned by phase one.
export function buildSourcePatch(source, formatter, gate, expectedFormatterVersion, formatterBefore) {
  published(source, baseline.source);
  buildFormatterPatch(formatterBefore, gate);
  if (typeof expectedFormatterVersion !== 'string' || !expectedFormatterVersion) fail();
  published(formatter, {
    ...baseline.formatter, versionId:expectedFormatterVersion,
    activeVersionId:expectedFormatterVersion
  });
  verifyGate(gate);
  unchangedAlertRoutes(formatter);
  if (!equal(node(formatter, baseline.formatterNode.id)?.parameters,
    {...baseline.formatterNode.parameters, jsCode:candidateCode})) fail();
  const expectedNodes = JSON.parse(JSON.stringify(formatterBefore.nodes));
  expectedNodes.find(n => n.id === baseline.formatterNode.id).parameters.jsCode = candidateCode;
  if (!equal(formatter.nodes, expectedNodes)
      || !equal(formatter.connections, formatterBefore.connections)
      || formatter.name !== formatterBefore.name
      || !equal(formatter.pinData, formatterBefore.pinData)) fail();
  return envelope(source, [{
    type:'updateSettings', settings:{errorWorkflow:baseline.formatter.id}
  }]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  const input = JSON.parse(readFileSync(process.argv[3] || 0, 'utf8'));
  const plan = mode === 'formatter'
    ? buildFormatterPatch(input.formatter, input.gate)
    : mode === 'source'
      ? buildSourcePatch(input.source, input.formatter, input.gate, input.expectedFormatterVersion, input.formatterBefore)
      : (() => { throw new Error('Expected formatter or source mode'); })();
  process.stdout.write(JSON.stringify(plan, null, 2) + '\n');
}

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ALERT_RECIPIENT,
  ALERT_SUBJECT,
  amountToCents,
  buildErrorWorkflow,
  buildMainWorkflow,
  buildQaWorkflow,
  compareParties,
  normalizeDocumentNumber,
} from './build-workflows.mjs';

function connectedTargets(workflow) {
  return Object.values(workflow.connections).flatMap((source) =>
    (source.main ?? []).flatMap((output) => (output ?? []).map((entry) => entry.node)),
  );
}

test('normalizes the leading Shopify hash without hiding real number differences', () => {
  assert.equal(normalizeDocumentNumber('#NEONT4562'), 'NEONT4562');
  assert.equal(normalizeDocumentNumber(' neont4562 '), 'NEONT4562');
  assert.notEqual(normalizeDocumentNumber('NEONT4563'), 'NEONT4562');
});

test('compares money in integer cents', () => {
  assert.equal(amountToCents('1028.00'), 102800);
  assert.equal(amountToCents('365.33'), 36533);
  assert.equal(amountToCents('invalid'), null);
});

test('matches customers deterministically by email or normalized name', () => {
  assert.deepEqual(
    compareParties({ emails: ['invoice@example.com'], names: [] }, { emails: ['INVOICE@example.com'], names: [] }),
    { matches: true, method: 'email', value: 'invoice@example.com' },
  );
  assert.equal(
    compareParties({ emails: [], names: ['Juli GmbH'] }, { emails: [], names: ['JULI GmbH'] }).matches,
    true,
  );
  assert.equal(
    compareParties({ emails: [], names: ['Juli GmbH'] }, { emails: [], names: ['Andere GmbH'] }).matches,
    false,
  );
});

test('main workflow has one trigger, daily 18:00 Berlin schedule, bounded retries and no continueOnFail', () => {
  const workflow = buildMainWorkflow('error-workflow-id');
  const triggers = workflow.nodes.filter((node) => node.type.endsWith('Trigger') || node.type.endsWith('scheduleTrigger'));
  assert.equal(triggers.length, 1);
  assert.equal(triggers[0].parameters.rule.interval[0].expression, '0 18 * * *');
  assert.equal(workflow.settings.timezone, 'Europe/Berlin');
  assert.equal(workflow.settings.errorWorkflow, 'error-workflow-id');
  assert.ok(workflow.nodes.length <= 30);
  for (const node of workflow.nodes) {
    assert.notEqual(node.continueOnFail, true);
    if (node.type === 'n8n-nodes-base.httpRequest') {
      assert.equal(node.retryOnFail, true);
      assert.equal(node.maxTries, 3);
    }
  }
});

test('main workflow sends only the requested internal alert through the verified Outlook credential', () => {
  const workflow = buildMainWorkflow('error-workflow-id');
  const mail = workflow.nodes.find((node) => node.name === 'Send Internal Alert');
  assert.equal(mail.parameters.toRecipients, ALERT_RECIPIENT);
  assert.equal(mail.credentials.microsoftOutlookOAuth2Api.id, 'CTEmJD5CjYu9hawu');
  const prepare = workflow.nodes.find((node) => node.name === 'Prepare Alert');
  assert.match(prepare.parameters.jsCode, new RegExp(ALERT_SUBJECT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('QA workflow is read-only and contains no email node', () => {
  const workflow = buildQaWorkflow();
  assert.equal(workflow.nodes.filter((node) => node.type === 'n8n-nodes-base.webhook').length, 1);
  assert.equal(workflow.nodes.some((node) => node.type === 'n8n-nodes-base.microsoftOutlook'), false);
  assert.equal(workflow.nodes.some((node) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(node.parameters?.method)), false);
});

test('error workflow is small, deterministic and uses the same requested subject', () => {
  const workflow = buildErrorWorkflow();
  assert.equal(workflow.nodes.filter((node) => node.type === 'n8n-nodes-base.errorTrigger').length, 1);
  assert.ok(workflow.nodes.length <= 30);
  assert.equal(workflow.nodes.some((node) => node.continueOnFail === true), false);
  const prepare = workflow.nodes.find((node) => node.name === 'Prepare Technical Alert');
  assert.match(prepare.parameters.jsCode, new RegExp(ALERT_SUBJECT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('every declared connection points to an existing node', () => {
  for (const workflow of [buildMainWorkflow('error-workflow-id'), buildErrorWorkflow(), buildQaWorkflow()]) {
    const names = new Set(workflow.nodes.map((node) => node.name));
    for (const source of Object.keys(workflow.connections)) assert.ok(names.has(source), `missing source ${source}`);
    for (const target of connectedTargets(workflow)) assert.ok(names.has(target), `missing target ${target}`);
  }
});

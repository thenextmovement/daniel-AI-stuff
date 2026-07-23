import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
  new URL('./prepare-alert-data.js', import.meta.url),
  'utf8',
);
const execute = new Function('$input', '$getWorkflowStaticData', source);

function payload(overrides = {}) {
  return {
    workflow: {
      id: overrides.workflowId ?? 'workflow-1',
      name: overrides.workflowName ?? 'Workflow <unsafe>',
    },
    execution: {
      id: overrides.executionId ?? '1234567',
      url: overrides.url ?? 'https://fuajob.online/workflow/workflow-1/executions/1234567',
      lastNodeExecuted: overrides.failedNode ?? 'Trello Trigger',
      error: {
        message: overrides.message ?? 'timeout exceeded for execution 1234567',
        description: overrides.description ?? '<script>alert(1)</script>',
      },
    },
  };
}

function run(state, value) {
  return execute(
    { first: () => ({ json: value }) },
    (scope) => {
      assert.equal(scope, 'global');
      return state;
    },
  );
}

test('emits the first alert and escapes untrusted HTML', () => {
  const state = {};
  const originalNow = Date.now;
  Date.now = () => Date.parse('2026-07-23T12:00:00.000Z');
  try {
    const result = run(state, payload());
    assert.equal(result.length, 1);
    assert.match(result[0].json.body_html, /Workflow &lt;unsafe&gt;/);
    assert.doesNotMatch(result[0].json.body_html, /<script>/);
    assert.equal(result[0].json.metadata.dedupe_window_minutes, 15);
  } finally {
    Date.now = originalNow;
  }
});

test('deduplicates the same workflow, node, and normalized error for 15 minutes', () => {
  const state = {};
  const originalNow = Date.now;
  let now = Date.parse('2026-07-23T12:00:00.000Z');
  Date.now = () => now;
  try {
    assert.equal(run(state, payload({ executionId: '1234567' })).length, 1);
    now += 1000;
    assert.equal(run(state, payload({
      executionId: '7654321',
      message: 'timeout exceeded for execution 7654321',
    })).length, 0);
    now += 15 * 60 * 1000;
    const result = run(state, payload({
      executionId: '9999999',
      message: 'timeout exceeded for execution 9999999',
    }));
    assert.equal(result.length, 1);
    assert.equal(result[0].json.metadata.suppressed_since_last_alert, 1);
  } finally {
    Date.now = originalNow;
  }
});

test('rejects external execution URLs', () => {
  const state = {};
  const originalNow = Date.now;
  Date.now = () => Date.parse('2026-07-23T12:00:00.000Z');
  try {
    const result = run(state, payload({ url: 'https://attacker.example/phish' }));
    assert.equal(result[0].json.metadata.execution_url, null);
    assert.doesNotMatch(result[0].json.body_html, /attacker\.example/);
  } finally {
    Date.now = originalNow;
  }
});

test('caps all alert emails at 20 per UTC hour', () => {
  const state = {};
  const originalNow = Date.now;
  Date.now = () => Date.parse('2026-07-23T12:00:00.000Z');
  try {
    for (let index = 0; index < 20; index += 1) {
      const result = run(state, payload({
        workflowId: `workflow-${index}`,
        message: `unique failure ${index}`,
      }));
      assert.equal(result.length, 1);
    }
    assert.equal(run(state, payload({
      workflowId: 'workflow-over-cap',
      message: 'one failure too many',
    })).length, 0);
  } finally {
    Date.now = originalNow;
  }
});

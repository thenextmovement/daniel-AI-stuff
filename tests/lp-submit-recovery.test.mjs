import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import runTest from 'node:test';
import vm from 'node:vm';

const helperSource = await readFile(
  new URL('../deploy/js/nt-submit-recovery.js', import.meta.url),
  'utf8'
);
const clientSubmitId = '44444444-4444-4444-8444-444444444444';

function createBaseContext(fetchImpl, source) {
  const context = {
    Blob,
    Error,
    TypeError,
    setTimeout,
    File,
    FormData,
    Headers,
    Promise,
    Response,
    URL,
    console,
    crypto,
    fetch: fetchImpl,
    location: { href: 'https://anfrage.neontrip.de/anfrage.html?utm_source=test', origin: 'https://anfrage.neontrip.de' },
    navigator: {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1',
      sendBeacon: () => true,
    },
    document: {
      documentElement: { lang: 'de' },
      referrer: '',
    },
  };
  context.window = context;
  vm.runInNewContext(source, context, { filename: 'submit-under-test.js' });
  if (!context.ntSubmitStandaloneForm) {
    context.ntSubmitStandaloneForm = (data, name) => context.ntSubmitForm({ getAttribute: () => '/api/c' }, data, name);
  }
  return context;
}

function formWithFile() {
  const form = new FormData();
  form.set('name', 'Internal Test');
  form.set('email', 'internal@neontrip-test.de');
  form.set('request_id', clientSubmitId);
  form.set('project_context', 'Filial- oder Serien-Rollout');
  form.set('quantity_band', 'Rollout 6–20 Stück');
  form.set('desired_deadline', '2026-10-15');
  form.append('datei', new File(['design'], 'design.svg', { type: 'image/svg+xml' }));
  return form;
}

function assertQualificationScalars(formData) {
  assert.equal(formData.get('project_context'), 'Filial- oder Serien-Rollout');
  assert.equal(formData.get('quantity_band'), 'Rollout 6–20 Stück');
  assert.equal(formData.get('desired_deadline'), '2026-10-15');
}

function receipt(extra = {}) {
  return new Response(JSON.stringify({
    ok: true, accepted: true, persisted: true, contact_saved: true,
    lead_request_id: clientSubmitId,
    request_row_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    customer_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    ...extra,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

const variants = [['standalone', helperSource]];
for (const file of ['deploy/_source/layouts/base.html', 'deploy/neon-schilder/index.html']) {
  const html = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
  const start = html.indexOf('window.ntReportSubmitFailure =');
  const end = html.indexOf("const form = document.getElementById('multi-step-form');", start);
  assert.ok(start >= 0 && end > start, file);
  variants.push([file, html.slice(start, end)]);
}

for (const [variant, source] of variants) {
const createContext = (fetchImpl) => createBaseContext(fetchImpl, source);
const test = (name, fn) => runTest(`${variant}: ${name}`, fn);

test('rebuilds affected WebKit files before the only primary request', async () => {
  let calls = 0;
  const context = createContext(async (_url, options) => {
    calls += 1;
    assertQualificationScalars(options.body);
    assert.equal(options.body.get('nt_webkit_file_rebuilt'), '1');
    assert.equal(options.body.get('datei').name, 'design.svg');
    return new Response(JSON.stringify({
      ok: true,
      accepted: true,
      persisted: true,
      contact_saved: true,
      lead_request_id: clientSubmitId,
      request_row_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      customer_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  const result = await context.ntSubmitStandaloneForm(formWithFile(), 'test_form');
  assert.equal(result.persisted, true);
  assert.equal(result.lead_request_id, clientSubmitId);
  assert.equal(calls, 1);
});

test('uses one contact-only recovery after definitive invalid_body', async () => {
  let calls = 0;
  const context = createContext(async (_url, options) => {
    calls += 1;
    assertQualificationScalars(options.body);
    if (calls === 1) {
      return new Response(JSON.stringify({
        ok: false,
        error: 'invalid_body',
        request_id: '11111111-1111-4111-8111-111111111111',
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    assert.equal(options.body.get('nt_recovery_contact'), '1');
    assert.equal(options.body.get('datei'), null);
    assert.match(options.body.get('nt_file_manifest'), /design\.svg/);
    return new Response(JSON.stringify({
      ok: true,
      accepted: true,
      persisted: true,
      recovery: true,
      contact_saved: true,
      request_id: '22222222-2222-4222-8222-222222222222',
      lead_request_id: clientSubmitId,
      request_row_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      customer_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });

  const result = await context.ntSubmitStandaloneForm(formWithFile(), 'test_form');
  assert.equal(result.recovery, true);
  assert.equal(result.contact_saved, true);
  assert.equal(calls, 2);
});

test('does not retry an upstream HTTP failure', async () => {
  let calls = 0;
  const context = createContext(async () => {
    calls += 1;
    return new Response(JSON.stringify({ ok: false, error: 'upstream_unreachable' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  await assert.rejects(
    context.ntSubmitStandaloneForm(formWithFile(), 'test_form'),
    /attempts=1/
  );
  assert.equal(calls, 1);
});

test('rejects a successful HTTP response without the matching database receipt', async () => {
  const context = createContext(async () => new Response(JSON.stringify({
    ok: true,
    accepted: true,
    persisted: true,
    contact_saved: true,
    lead_request_id: '55555555-5555-4555-8555-555555555555',
    request_row_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    customer_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

  await assert.rejects(
    context.ntSubmitStandaloneForm(formWithFile(), 'test_form'),
    /persistence_unconfirmed/
  );
});

test('does not retry a definitive business-email rejection', async () => {
  let calls = 0;
  const context = createContext(async () => {
    calls += 1;
    return new Response(JSON.stringify({
      ok: false,
      error: 'business_email_required',
      field: 'email',
    }), {
      status: 422,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  await assert.rejects(
    context.ntSubmitStandaloneForm(formWithFile(), 'test_form'),
    /attempts=1/
  );
  assert.equal(calls, 1);
});

test('fires a conversion only once per submit id', () => {
  const context = createContext(async () => new Response('{}', { status: 200 }));
  let conversions = 0;
  context.ntFireConversionOnce('same-submit-id', () => { conversions += 1; });
  context.ntFireConversionOnce('same-submit-id', () => { conversions += 1; });
  assert.equal(conversions, 1);
});


test('retries a transport failure once with the same UUID, fields and file payload', async () => {
  const requests = [];
  const context = createContext(async (_url, options) => {
    requests.push(options);
    if (requests.length === 1) throw new TypeError('Load failed');
    return receipt({ replay: true, created: false });
  });
  const result = await context.ntSubmitStandaloneForm(formWithFile(), 'hero_form_mobile');
  assert.equal(requests.length, 2);
  assert.equal(result.replay, true);
  assert.equal(result.submit_id, clientSubmitId);
  assert.equal(requests[0].body, requests[1].body);
  for (const request of requests) {
    assert.equal(request.headers['X-Client-Submit-Id'], clientSubmitId);
    assert.equal(request.body.get('request_id'), clientSubmitId);
    assert.equal(request.body.get('nt_client_submit_id'), clientSubmitId);
    assert.equal(request.body.get('custom_6703e7e2e253b1_87194328'), clientSubmitId);
    assert.equal(request.body.get('email'), 'internal@neontrip-test.de');
    assert.equal(await request.body.get('datei').text(), 'design');
    assert.equal(request.body.get('nt_recovery_contact'), null);
  }
});

test('stops after two transport failures and reports the real phase and count', async () => {
  let calls = 0;
  const context = createContext(async () => { calls += 1; throw new TypeError('Load failed'); });
  await assert.rejects(context.ntSubmitStandaloneForm(formWithFile(), 'hero_form_mobile'), (err) => {
    assert.equal(err.attempts, 2);
    assert.equal(err.phase, 'request');
    assert.equal(err.networkRetryAttempted, true);
    assert.equal(err.clientSubmitId, clientSubmitId);
    assert.match(err.message, /attempts=2 \| phase=request \| network_retry=true/);
    assert.ok(err.elapsedMs >= 0);
    return true;
  });
  assert.equal(calls, 2);
});

test('does not resend after a file-read failure before the request', async () => {
  let calls = 0;
  const context = createContext(async () => { calls += 1; return receipt(); });
  const form = formWithFile();
  form.get('datei').arrayBuffer = async () => { throw new TypeError('Load failed'); };
  await assert.rejects(context.ntSubmitStandaloneForm(form, 'test_form'), (err) => {
    assert.equal(err.attempts, 0);
    assert.equal(err.phase, 'prepare');
    assert.equal(err.networkRetryAttempted, false);
    return true;
  });
  assert.equal(calls, 0);
});

test('does not retry an explicit abort', async () => {
  let calls = 0;
  const context = createContext(async () => {
    calls += 1;
    const err = new Error('Aborted');
    err.name = 'AbortError';
    throw err;
  });
  await assert.rejects(context.ntSubmitStandaloneForm(formWithFile(), 'test_form'), /attempts=1/);
  assert.equal(calls, 1);
});

test('keeps definitive upload recovery available after the bounded network retry', async () => {
  let calls = 0;
  const context = createContext(async (_url, options) => {
    calls += 1;
    if (calls === 1) throw new TypeError('Load failed');
    if (calls === 2) return new Response(JSON.stringify({ error: 'invalid_body' }), { status: 400 });
    assert.equal(options.body.get('nt_recovery_contact'), '1');
    assert.equal(options.body.get('datei'), null);
    assert.equal(options.body.get('request_id'), clientSubmitId);
    return receipt({ recovery: true });
  });
  const result = await context.ntSubmitStandaloneForm(formWithFile(), 'test_form');
  assert.equal(result.recovery, true);
  assert.equal(calls, 3);
});

test('does not add another network retry to contact-only recovery', async () => {
  let calls = 0;
  const context = createContext(async () => {
    calls += 1;
    if (calls === 1) return new Response(JSON.stringify({ error: 'invalid_body' }), { status: 400 });
    throw new TypeError('Load failed');
  });
  await assert.rejects(context.ntSubmitStandaloneForm(formWithFile(), 'test_form'), (err) => {
    assert.equal(err.attempts, 2);
    assert.equal(err.recoveryAttempted, true);
    assert.equal(err.networkRetryAttempted, false);
    return true;
  });
  assert.equal(calls, 2);
});

if (variant !== 'standalone') {
  test('never automatically retries a different endpoint or origin', async () => {
    for (const action of ['/api/other', 'https://other.example/api/c']) {
      let calls = 0;
      const context = createContext(async () => { calls += 1; throw new TypeError('Load failed'); });
      await assert.rejects(context.ntSubmitForm({ getAttribute: () => action }, formWithFile(), 'test_form'), /attempts=1/);
      assert.equal(calls, 1, action);
    }
  });
}
}

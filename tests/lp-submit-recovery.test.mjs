import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const helperSource = await readFile(
  new URL('../deploy/js/nt-submit-recovery.js', import.meta.url),
  'utf8'
);
const clientSubmitId = '44444444-4444-4444-8444-444444444444';

function createContext(fetchImpl) {
  const context = {
    Blob,
    Error,
    File,
    FormData,
    Headers,
    Promise,
    Response,
    URL,
    console,
    crypto,
    fetch: fetchImpl,
    location: { href: 'https://anfrage.neontrip.de/anfrage.html?utm_source=test' },
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
  vm.runInNewContext(helperSource, context, { filename: 'nt-submit-recovery.js' });
  return context;
}

function formWithFile() {
  const form = new FormData();
  form.set('name', 'Internal Test');
  form.set('email', 'internal@example.invalid');
  form.set('request_id', clientSubmitId);
  form.append('datei', new File(['design'], 'design.svg', { type: 'image/svg+xml' }));
  return form;
}

test('rebuilds affected WebKit files before the only primary request', async () => {
  let calls = 0;
  const context = createContext(async (_url, options) => {
    calls += 1;
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

test('does not retry ambiguous upstream or network failures', async () => {
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

test('fires a conversion only once per submit id', () => {
  const context = createContext(async () => new Response('{}', { status: 200 }));
  let conversions = 0;
  context.ntFireConversionOnce('same-submit-id', () => { conversions += 1; });
  context.ntFireConversionOnce('same-submit-id', () => { conversions += 1; });
  assert.equal(conversions, 1);
});

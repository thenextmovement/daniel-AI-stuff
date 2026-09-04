import assert from 'node:assert/strict';
import test from 'node:test';

import { onRequestPost } from '../functions/api/c.js';

const clientSubmitId = '44444444-4444-4444-8444-444444444444';

function context(request) {
  return {
    request,
    waitUntil() {},
  };
}

test('LP intake proxy recovery contract', async (t) => {
  await t.test('returns correlated invalid_body before any upstream call', async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return new Response('{}', { status: 200 });
    };
    try {
      const request = new Request('https://anfrage.neontrip.de/api/c', {
        method: 'POST',
        headers: {
          'Content-Type': 'multipart/form-data; boundary=broken',
          'X-Client-Submit-Id': clientSubmitId,
        },
        body: 'not-a-valid-multipart-body',
      });
      const response = await onRequestPost(context(request));
      const body = await response.json();
      assert.equal(response.status, 400);
      assert.equal(body.error, 'invalid_body');
      assert.equal(body.client_submit_id, clientSubmitId);
      assert.equal(calls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test('returns a receipt only after confirmed recovery persistence', async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return new Response(JSON.stringify({
        ok: true,
        accepted: true,
        persisted: true,
        contact_saved: true,
        request_id: clientSubmitId,
        request_row_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        customer_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        trello_card_id: 'internal-card-id',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    try {
      const formData = new FormData();
      formData.set('name', 'Internal Test');
      formData.set('email', 'internal@neontrip-test.de');
      formData.set('request_id', clientSubmitId);
      formData.set('nt_client_submit_id', clientSubmitId);
      formData.set('nt_recovery_contact', '1');
      const request = new Request('https://anfrage.neontrip.de/api/c', {
        method: 'POST',
        headers: { 'X-Client-Submit-Id': clientSubmitId },
        body: formData,
      });
      const response = await onRequestPost(context(request));
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.recovery, true);
      assert.equal(body.contact_saved, true);
      assert.equal(body.lead_request_id, clientSubmitId);
      assert.equal(calls, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test('waits for the authoritative receipt and keeps company optional', async () => {
    const originalFetch = globalThis.fetch;
    let release;
    globalThis.fetch = (_url, options) => {
      assert.equal(options.body.get('email'), 'Internal@neontrip-test.de');
      assert.equal(options.body.get('firma'), null);
      assert.equal(options.body.get('project_context'), 'Messe, Event oder Pop-up');
      assert.equal(options.body.get('quantity_band'), 'Serienproduktion 21+ Stück');
      assert.equal(options.body.get('desired_deadline'), '2026-09-25');
      assert.equal(
        options.body.get('nachricht'),
        'Bitte um Machbarkeitsprüfung.\n\n' +
          'Projektqualifizierung:\n' +
          'Anwendungsfall: Messe, Event oder Pop-up\n' +
          'Menge / Rollout: Serienproduktion 21+ Stück\n' +
          'Wunschtermin: 2026-09-25'
      );
      assert.equal(
        options.body.get('custom_6703d0b36ebc54_95825950'),
        'Wunschtermin 2026-09-25'
      );
      return new Promise((resolve) => { release = resolve; });
    };
    try {
      const formData = new FormData();
      formData.set('name', 'Internal Test');
      formData.set('email', 'Internal@NEONTRIP-TEST.DE');
      formData.set('nachricht', 'Bitte um Machbarkeitsprüfung.');
      formData.set('project_context', 'Messe, Event oder Pop-up');
      formData.set('quantity_band', 'Serienproduktion 21+ Stück');
      formData.set('desired_deadline', '2026-09-25');
      const request = new Request('https://anfrage.neontrip.de/api/c', {
        method: 'POST',
        headers: { 'X-Client-Submit-Id': clientSubmitId },
        body: formData,
      });
      let settled = false;
      const responsePromise = onRequestPost(context(request)).then((response) => {
        settled = true;
        return response;
      });
      while (!release) await new Promise((resolve) => setImmediate(resolve));
      assert.equal(settled, false);
      release(new Response(JSON.stringify({
        ok: true,
        accepted: true,
        persisted: true,
        contact_saved: true,
        created: true,
        replay: false,
        request_id: clientSubmitId,
        request_row_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        customer_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
      const response = await responsePromise;
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.accepted, true);
      assert.equal(body.persisted, true);
      assert.equal(body.lead_request_id, clientSubmitId);
      assert.equal(body.request_row_id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test('rejects an upstream 200 without a matching persistence receipt', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({
      ok: true,
      accepted: true,
      persisted: false,
      request_id: clientSubmitId,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    try {
      const formData = new FormData();
      formData.set('name', 'Internal Test');
      formData.set('email', 'internal@neontrip-test.de');
      formData.set('request_id', clientSubmitId);
      const request = new Request('https://anfrage.neontrip.de/api/c', {
        method: 'POST',
        headers: { 'X-Client-Submit-Id': clientSubmitId },
        body: formData,
      });
      const response = await onRequestPost(context(request));
      const body = await response.json();
      assert.equal(response.status, 502);
      assert.equal(body.error, 'persistence_unconfirmed');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test('rejects missing, malformed and personal-provider email addresses before any side effect', async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    let waitUntilCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      return new Response('{}', { status: 200 });
    };
    try {
      const rejected = [
        '',
        'not-an-email',
        'name@gmail.com',
        'name@sub.gmail.com',
        'name@mail.de',
        'name@pm.me',
        'name@mailinator.com',
        'name@company.com/path',
      ];
      for (const email of rejected) {
        const formData = new FormData();
        formData.set('name', 'Internal Test');
        if (email) formData.set('email', email);
        const request = new Request('https://anfrage.neontrip.de/api/c', {
          method: 'POST',
          headers: { 'X-Client-Submit-Id': clientSubmitId },
          body: formData,
        });
        const response = await onRequestPost({
          request,
          waitUntil() { waitUntilCalls += 1; },
        });
        const body = await response.json();
        assert.equal(response.status, 422, email || '(missing email)');
        assert.equal(body.error, 'business_email_required');
        assert.equal(body.field, 'email');
        assert.equal(body.client_submit_id, clientSubmitId);
      }
      assert.equal(fetchCalls, 0);
      assert.equal(waitUntilCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.test('keeps the synthetic dry-run side-effect free and independent of email', async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return new Response('{}', { status: 200 });
    };
    try {
      const formData = new FormData();
      formData.set('nt_dry_run', '1');
      const request = new Request('https://anfrage.neontrip.de/api/c', {
        method: 'POST',
        body: formData,
      });
      const response = await onRequestPost(context(request));
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.dry_run, true);
      assert.equal(calls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

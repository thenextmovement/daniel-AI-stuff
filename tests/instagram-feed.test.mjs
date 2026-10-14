import assert from 'node:assert/strict';
import test from 'node:test';
import {onRequest} from '../functions/api/instagram.js';

const source = 'https://scontent.cdninstagram.com/photo.jpg';
const fixture = {meta: {code: 200, username: 'theneontrip'}, data: [{
  id: '123', link: 'https://www.instagram.com/p/example/',
  images: {standard_resolution: {url: source}}, caption: {text: 'Ein Neonschild'},
  created_time: 1700000000,
}]};

async function withFeed(run, transformFails = false) {
  const originalFetch = globalThis.fetch;
  const originalCaches = globalThis.caches;
  const entries = new Map();
  const calls = [];
  globalThis.caches = {default: {
    match: async key => entries.get(key.url)?.clone(),
    put: async (key, value) => entries.set(key.url, value.clone()),
  }};
  globalThis.fetch = async (url, options) => {
    calls.push({url, options});
    if (String(url).startsWith('https://instafeed.nfcube.com/')) return Response.json(fixture);
    assert.equal(url, source);
    if (options.cf && transformFails) return new Response('Unavailable', {status: 502});
    return new Response(new Uint8Array([1, 2, 3]), {headers: {'Content-Type': options.cf ? 'image/webp' : 'image/jpeg'}});
  };
  const request = async query => {
    const pending = [];
    const result = await onRequest({request: new Request('https://anfrage.neontrip.de/api/instagram' + query),
      env: {INSTAFEED_API_KEY: 'test-only'}, waitUntil: task => pending.push(task)});
    await Promise.all(pending);
    return result;
  };
  try { await run({request, calls, entries}); }
  finally { globalThis.fetch = originalFetch; globalThis.caches = originalCaches; }
}

test('responsive images use bounded centered WebP transforms without forwarding credentials', async () => {
  await withFeed(async ({request, calls}) => {
    const result = await request('?image=123&w=640');
    assert.equal(result.status, 200);
    assert.equal(result.headers.get('Content-Type'), 'image/webp');
    assert.equal(result.headers.get('X-Neontrip-Image'), 'optimized');
    assert.equal(result.headers.get('Cache-Control'), 'public, max-age=86400');
    const image = calls.find(call => call.url === source);
    assert.deepEqual(image.options.cf.image, {width: 640, height: 640, fit: 'cover', quality: 82, format: 'webp', metadata: 'none'});
    assert.equal(image.options.headers, undefined);
    assert.equal(image.options.redirect, 'manual');
  });
});

test('each image size has its own cache and repeat requests reuse it', async () => {
  await withFeed(async ({request, calls}) => {
    await request('?image=123&w=480');
    await request('?image=123&w=960');
    await request('?image=123&w=480');
    assert.deepEqual(calls.filter(call => call.url === source).map(call => call.options.cf.image.width), [480, 960]);
    assert.equal(calls.filter(call => String(call.url).includes('feed/v6')).length, 1);
  });
});

test('unsupported dimensions and arbitrary URLs are rejected before contacting providers', async () => {
  await withFeed(async ({request, calls}) => {
    for (const query of ['?image=123&w=99999', '?w=480', '?image=123&url=https://example.com', '?image=../123']) {
      assert.equal((await request(query)).status, 400);
    }
    assert.equal(calls.length, 0);
    assert.equal((await request('?image=unknown&w=480')).status, 404);
    assert.equal(calls.filter(call => call.url === source).length, 0);
  });
});

test('a transform outage preserves the photo and only caches the fallback briefly', async () => {
  await withFeed(async ({request, calls}) => {
    const result = await request('?image=123&w=640');
    assert.equal(result.status, 200);
    assert.equal(result.headers.get('Content-Type'), 'image/jpeg');
    assert.equal(result.headers.get('Cache-Control'), 'public, max-age=300');
    assert.equal(result.headers.get('X-Neontrip-Image'), 'original');
    assert.equal(calls.filter(call => call.url === source).length, 2);
  }, true);
});

test('feed metadata keeps the existing same-origin image contract', async () => {
  await withFeed(async ({request}) => {
    const data = await (await request('')).json();
    assert.equal(data.available, true);
    assert.equal(data.username, 'theneontrip');
    assert.equal(data.posts[0].image, '/api/instagram?image=123');
    assert.ok(!JSON.stringify(data).includes(source));
    assert.ok(!JSON.stringify(data).includes('test-only'));
  });
});

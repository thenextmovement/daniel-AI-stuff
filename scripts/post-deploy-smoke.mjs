#!/usr/bin/env node
const baseUrl = (process.argv[2] || 'https://anfrage.neontrip.de').replace(/\/$/, '');
const realAlert = process.argv.includes('--real-alert');

const paths = [
  '/logo/?kw=led%20logo&utm_source=google&utm_medium=cpc&gclid=smoke-gclid',
  '/neon-schilder/?kw=neon%20schild&utm_source=google&utm_medium=cpc&gclid=smoke-gclid',
  '/leuchtreklame/?kw=leuchtreklame%20kaufen&utm_source=google&utm_medium=cpc&gclid=smoke-gclid',
  '/firmenschilder/?kw=firmenschild%20led&utm_source=google&utm_medium=cpc&gclid=smoke-gclid',
];

async function assertOk(label, promise) {
  const response = await promise;
  if (!response.ok) {
    throw new Error(`${label} failed: HTTP ${response.status}`);
  }
  return response;
}

for (const path of paths) {
  await assertOk(`GET ${path}`, fetch(`${baseUrl}${path}`, { redirect: 'follow' }));
}

const formData = new FormData();
formData.set('nt_dry_run', '1');
formData.set('source', 'deploy-smoke');
formData.set('name', 'Deploy Smoke');
formData.set('email', 'deploy-smoke@neontrip.invalid');
formData.set('telefon', '+490000000000');
formData.set('landing_page_url', `${baseUrl}/logo/?kw=led%20logo`);
formData.set('_landing_page_url', `${baseUrl}/logo/?kw=led%20logo`);
formData.set('referrer', 'deploy-smoke');
formData.set('_referrer', 'deploy-smoke');
formData.set('gclid', 'deploy-smoke-gclid');

const submitResponse = await assertOk('POST /api/c dry-run', fetch(`${baseUrl}/api/c`, {
  method: 'POST',
  body: formData,
}));
const submitJson = await submitResponse.json();
if (!submitJson.ok || !submitJson.dry_run) {
  throw new Error(`POST /api/c returned unexpected body: ${JSON.stringify(submitJson)}`);
}

const failPayload = {
  nt_dry_run: realAlert ? '0' : '1',
  form: 'deploy-smoke',
  error: realAlert ? 'real-alert-smoke' : 'dry-run-smoke',
  url: `${baseUrl}/logo/?kw=led%20logo`,
  referrer: 'deploy-smoke',
  ts: new Date().toISOString(),
};
const failResponse = await assertOk(`${realAlert ? 'POST /api/r real alert' : 'POST /api/r dry-run'}`, fetch(`${baseUrl}/api/r`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(failPayload),
}));
const failText = await failResponse.text();
if (!failText.includes('"ok":true')) {
  throw new Error(`POST /api/r returned unexpected body: ${failText}`);
}

console.log(`Post-deploy smoke passed for ${baseUrl}${realAlert ? ' (real alert sent)' : ''}.`);

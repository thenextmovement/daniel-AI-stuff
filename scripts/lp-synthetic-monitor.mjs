#!/usr/bin/env node
const baseUrl = (process.env.LP_MONITOR_BASE_URL || 'https://anfrage.neontrip.de').replace(/\/$/, '');
const alertWebhookUrl = process.env.LP_MONITOR_ALERT_WEBHOOK_URL || '';
const alertWebhookHeader = process.env.LP_MONITOR_ALERT_WEBHOOK_HEADER || '';
const startedAt = new Date();

const paths = [
  '/logo/?kw=led%20logo&utm_source=synthetic&utm_medium=monitor&gclid=monitor-gclid',
  '/neon-schilder/?kw=neon%20schild&utm_source=synthetic&utm_medium=monitor&gclid=monitor-gclid',
  '/leuchtreklame/?kw=leuchtreklame%20kaufen&utm_source=synthetic&utm_medium=monitor&gclid=monitor-gclid',
  '/firmenschilder/?kw=firmenschild%20led&utm_source=synthetic&utm_medium=monitor&gclid=monitor-gclid',
];

const failures = [];

async function capture(label, fn) {
  try {
    return await fn();
  } catch (error) {
    failures.push(`${label}: ${error.message}`);
    return null;
  }
}

async function assertOk(label, response) {
  if (!response) throw new Error('no response');
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response;
}

for (const path of paths) {
  await capture(`GET ${path}`, async () => {
    const response = await fetch(`${baseUrl}${path}`, { redirect: 'follow' });
    await assertOk(`GET ${path}`, response);
  });
}

await capture('POST /api/c dry-run', async () => {
  const landingPageUrl = `${baseUrl}/logo/?kw=led%20logo&utm_source=synthetic&utm_medium=monitor&gclid=monitor-gclid`;
  const formData = new FormData();
  formData.set('nt_dry_run', '1');
  formData.set('source', 'lp-synthetic-monitor');
  formData.set('name', 'LP Synthetic Monitor');
  formData.set('email', 'lp-monitor@neontrip.invalid');
  formData.set('telefon', '+490000000000');
  formData.set('landing_page_url', landingPageUrl);
  formData.set('_landing_page_url', landingPageUrl);
  formData.set('current_page_url', landingPageUrl);
  formData.set('referrer', 'lp-synthetic-monitor');
  formData.set('_referrer', 'lp-synthetic-monitor');
  formData.set('utm_source', 'synthetic');
  formData.set('utm_medium', 'monitor');
  formData.set('gclid', 'monitor-gclid');

  const response = await fetch(`${baseUrl}/api/c`, {
    method: 'POST',
    body: formData,
  });
  await assertOk('POST /api/c dry-run', response);
  const json = await response.json();
  if (!json.ok || !json.dry_run) {
    throw new Error(`unexpected body ${JSON.stringify(json)}`);
  }
});

await capture('POST /api/r dry-run', async () => {
  const response = await fetch(`${baseUrl}/api/r`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nt_dry_run: '1',
      form: 'lp-synthetic-monitor',
      error: 'dry-run-alert-path-check',
      url: `${baseUrl}/logo/?kw=led%20logo`,
      referrer: 'lp-synthetic-monitor',
      ts: new Date().toISOString(),
    }),
  });
  await assertOk('POST /api/r dry-run', response);
  const text = await response.text();
  if (!text.includes('"ok":true')) throw new Error(`unexpected body ${text}`);
});

async function notifyFailures() {
  if (!alertWebhookUrl || failures.length === 0) return;

  const headers = { 'Content-Type': 'application/json' };
  if (alertWebhookHeader) {
    const separator = alertWebhookHeader.indexOf(':');
    if (separator > 0) {
      headers[alertWebhookHeader.slice(0, separator).trim()] = alertWebhookHeader.slice(separator + 1).trim();
    }
  }

  const response = await fetch(alertWebhookUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      severity: 'critical',
      service: 'neontrip-lp',
      monitor: 'lp-synthetic-monitor',
      base_url: baseUrl,
      started_at: startedAt.toISOString(),
      finished_at: new Date().toISOString(),
      failures,
    }),
  });

  if (!response.ok) {
    throw new Error(`alert webhook failed: HTTP ${response.status}`);
  }
}

if (failures.length) {
  console.error('LP synthetic monitor FAILED:');
  for (const failure of failures) console.error(`- ${failure}`);
  await notifyFailures();
  process.exit(1);
}

console.log(`LP synthetic monitor passed for ${baseUrl}.`);

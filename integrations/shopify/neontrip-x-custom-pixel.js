// Shopify Admin > Settings > Customer events > Custom pixel.
// Permissions: Marketing required; data sale = data qualifies as data sale.
// This script records consent/checkout attribution only. Purchases are sent by n8n
// after authenticated Shopify payment verification. No email, name, IP or design.
(function () {
  const ENDPOINT = 'https://ops.neontrip.de/api/public/measurement/x';
  const KEY = 'nt_x_shopify_v1', CHECKOUTS = 'nt_x_checkouts_v1', TTL = 30 * 86400000;
  const HOSTS = new Set(['www.neontrip.de', 'neontrip.de', 'galaxybuzzdk.myshopify.com', 'checkout.neontrip.de']);
  let privacy = init.customerPrivacy, sequence = Promise.resolve();
  function allowed() { return privacy?.marketingAllowed === true && privacy?.saleOfDataAllowed === true; }
  function contextUrl(event) {
    try { const u = new URL(event?.context?.document?.location?.href || init.context?.document?.location?.href); return HOSTS.has(u.hostname) ? u : null; } catch { return null; }
  }
  async function read(key = KEY) { try { return JSON.parse(await browser.localStorage.getItem(key) || 'null'); } catch { return null; } }
  async function erase() { try { await browser.localStorage.removeItem(KEY); } catch {} }
  function fresh(c) { return c && /^[A-Za-z0-9._~-]{1,512}$/.test(c.twclid || '') && Number.isFinite(c.at) && c.at <= Date.now() && c.at > Date.now()-TTL; }
  async function send(body) {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (body.marketing_allowed && !allowed()) return;
      try { const response = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'omit', referrerPolicy: 'no-referrer', keepalive: true, body: JSON.stringify(body) }); if (response.ok) return; } catch {}
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  async function handle(event) {
    if (!allowed()) return;
    const url = contextUrl(event); if (!url || url.searchParams.has('qa') || url.searchParams.get('utm_source') === 'tracking_qa') return;
    let saved = await read();
    if (!allowed()) return;
    if (saved && !fresh(saved)) { await erase(); saved = null; }
    const incoming = url.searchParams.get('twclid');
    if (incoming !== null) {
      if (!/^[A-Za-z0-9._~-]{1,512}$/.test(incoming)) { await erase(); return; }
      if (!fresh(saved) || saved.twclid !== incoming) {
        saved = { twclid: incoming, at: Date.now(), consent_at: new Date().toISOString() };
        await browser.localStorage.setItem(KEY, JSON.stringify(saved));
      }
    } else if (['gclid','gbraid','wbraid','utm_source','utm_campaign','utm_id'].some(k => url.searchParams.has(k))) { await erase(); return; }
    if (!allowed() || !fresh(saved)) return;
    const token = event?.data?.checkout?.token;
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{16,256}$/.test(token)) return;
    const checkouts = (await read(CHECKOUTS) || []).filter(c => c.at > Date.now()-TTL && c.token !== token);
    if (!allowed()) return;
    await browser.localStorage.setItem(CHECKOUTS, JSON.stringify([...checkouts, { token, at: Date.now() }]));
    await send({ checkout_token: token, marketing_allowed: true, twclid: saved.twclid, click_at: new Date(saved.at).toISOString(), consent_at: saved.consent_at });
  }
  function queue(event) { sequence = sequence.then(() => handle(event)).catch(() => {}); }
  for (const name of ['page_viewed','checkout_started','checkout_contact_info_submitted','checkout_address_info_submitted','checkout_shipping_info_submitted','payment_info_submitted','checkout_completed']) analytics.subscribe(name, queue);
  api.customerPrivacy.subscribe('visitorConsentCollected', async event => {
    privacy = event.customerPrivacy;
    if (!allowed()) {
      const checkouts = await read(CHECKOUTS) || [];
      await erase();
      for (const c of checkouts) if (c.at > Date.now()-TTL) await send({ checkout_token: c.token, marketing_allowed: false });
      await browser.localStorage.removeItem(CHECKOUTS);
    } else { queue({ context: init.context }); }
  });
  if (allowed()) queue({ context: init.context });
})();

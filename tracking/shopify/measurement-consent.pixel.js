// NEONTRIP consent withdrawal only. Install as a separate custom pixel with
// no marketing/analytics permission requirement: it sends no marketing event,
// no Google request, no contact data and no cookies. Existing pixels stay intact.
// Custom pixel API: https://shopify.dev/docs/api/web-pixels-api/pixel-privacy
(() => {
  let privacy = init.customerPrivacy;
  let reference = null;
  let pending = false;
  let revoked = false;
  const denied = () => privacy?.marketingAllowed === false || privacy?.analyticsProcessingAllowed === false;
  async function revoke() {
    if (!denied() || !reference || pending || revoked) return;
    pending = true;
    try {
      const response = await fetch('https://angebote.neontrip.de/api/public/configurator/measurement-consent', {
        method: 'POST', headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ ...reference, revoke: true }), keepalive: true,
      });
      revoked = response.ok && (await response.json()).revoked === true;
    } catch { /* Only a later natural privacy/checkout event may retry revocation. */ }
    finally { pending = false; }
  }
  api.customerPrivacy.subscribe('visitorConsentCollected', event => {
    privacy = event.customerPrivacy;
    void revoke();
  });
  for (const name of ['checkout_started', 'checkout_contact_info_submitted', 'checkout_address_info_submitted', 'payment_info_submitted', 'checkout_completed']) {
    analytics.subscribe(name, event => {
      const attributes = event.data?.checkout?.attributes;
      if (!Array.isArray(attributes)) return;
      const ids = attributes.filter(a => a.key === 'NEONTRIP Entwurf');
      const tokens = attributes.filter(a => a.key === 'NEONTRIP Messwiderruf');
      if (ids.length !== 1 || tokens.length !== 1 || !/^[a-f0-9]{64}$/.test(ids[0].value) || !/^[a-f0-9]{64}$/.test(tokens[0].value)) return;
      if (reference?.checkoutId !== ids[0].value) revoked = false;
      reference = { checkoutId: ids[0].value, token: tokens[0].value };
      void revoke();
    });
  }
})();

// Measurement only: no design text, customer data, cart IDs or checkout URLs.
// Payment remains measured by the existing Shopify purchase integration.
const EVENTS = new Set(['configurator_engaged','add_to_cart','configurator_delivery_opened','begin_checkout','configurator_checkout_ready']);
const COMMERCE = new Set(['add_to_cart','begin_checkout']);
export function createConfiguratorTracker(browser = globalThis) {
  const sent = new Set();
  return function track(name, {quantity = 1, key = name} = {}) {
    try {
      const consent = browser.Cookiebot;
      if (!EVENTS.has(name) || browser.location?.hostname !== 'anfrage.neontrip.de' ||
          browser.location.hash.startsWith('#design=') || consent?.hasResponse !== true ||
          consent.consent?.statistics !== true) return false;
      const dedup = name + ':' + key;
      if (sent.has(dedup)) return false;
      const params = {send_to:'G-NEEVFC08VX',page_type:'configurator'};
      if (COMMERCE.has(name)) {
        if (!Number.isInteger(quantity) || quantity < 1) return false;
        params.items=[{item_id:'neontrip-led-text',item_name:'LED-Neon-Schriftzug',quantity}];
      }
      // Never let a blocked or failing analytics library interrupt a purchase.
      let measured = false;
      try {if (typeof browser.gtag === 'function') {browser.gtag('event',name,params);measured=true;}} catch {}
      try {if (typeof browser.clarity === 'function') {browser.clarity('event',name);measured=true;}} catch {}
      if (measured) sent.add(dedup);
      return measured;
    } catch {return false;}
  };
}

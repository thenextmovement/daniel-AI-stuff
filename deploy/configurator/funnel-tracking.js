// Existing funnel contract, with shared consent-gated CRO metadata.
// Payment remains measured by the existing Shopify purchase integration.
import {createCroTracker} from '../js/nt-cro.js?v=20261013-cro1';
import {initCroPage} from '../js/nt-cro-page.js?v=20261013-cro1';
export function createConfiguratorTracker(browser = globalThis) {
  const cro = browser.document ? initCroPage(browser) : createCroTracker(browser,'configurator');
  return function track(name,{quantity = 1,key = name} = {}) {
    try { return cro?.emit(name,{quantity},key) || false; } catch { return false; }
  };
}

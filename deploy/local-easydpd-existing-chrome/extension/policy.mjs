export const NATIVE_HOST = "de.neontrip.easydpd_existing_chrome";
export const BRIDGE_PROTOCOL_VERSION = 2;
export const SHOPIFY_ORIGIN = "https://admin.shopify.com";
export const SHOPIFY_APP_PATH = "/store/galaxybuzzdk/apps/dpd-versand-services";
export const SHOPIFY_PATH = "/store/galaxybuzzdk/apps/dpd-versand-services/fulfillments/create";
export const SHOP_DOMAIN = "galaxybuzzdk.myshopify.com";
export const EASYDPD_FRAME_ORIGIN = "https://easydpd.247apps.de";
export const ALLOWED_PRODUCTS = new Set([
  "B2C",
  "B2C Predict",
  "DPD Express 8:30",
  "DPD Express 12:00",
  "DPD Express 18:00",
]);

export function validateOrderUrl(rawUrl) {
  const url = new URL(String(rawUrl || ""));
  const keys = [...url.searchParams.keys()];
  if (url.origin !== SHOPIFY_ORIGIN
    || url.pathname !== SHOPIFY_PATH
    || !/^[0-9]{6,30}$/.test(String(url.searchParams.get("id") || ""))
    || url.searchParams.get("shop") !== SHOP_DOMAIN
    || keys.some((key) => !["id", "shop"].includes(key))) {
    throw new Error("Shopify-Auftrags-URL liegt ausserhalb der freigegebenen EasyDPD-Route.");
  }
  return url.toString();
}

export function validateEasyDpdLabelDownloadUrl(rawUrl) {
  const url = new URL(String(rawUrl || ""));
  if (url.origin !== EASYDPD_FRAME_ORIGIN
    || url.username
    || url.password
    || url.hash
    || !/^\/labels\/\d+\/download\//.test(url.pathname)) {
    throw new Error("EasyDPD-Label-Download liegt ausserhalb der freigegebenen Route.");
  }
  return url.toString();
}

export function validateBridgeJob(job) {
  if (!job || typeof job !== "object") throw new Error("Browser-Auftrag fehlt.");
  if (!/^[0-9a-f-]{36}$/i.test(String(job.id || ""))) throw new Error("Browser-Auftrags-ID ist ungueltig.");
  validateOrderUrl(job.orderUrl);
  if (!ALLOWED_PRODUCTS.has(job.productLabel)) throw new Error("EasyDPD-Produkt ist nicht freigegeben.");
  if (job.labelFormat !== "Einzeln auf A6" || job.packageWeightGrams !== 500) throw new Error("EasyDPD-Format oder Gewicht ist nicht freigegeben.");
  if (!Number.isInteger(job.maximumPurchaseCents) || job.maximumPurchaseCents < 1 || job.maximumPurchaseCents > 1500) {
    throw new Error("Kaufpreisgrenze ist ungueltig.");
  }
  if (!/^\d{10,40}$/.test(String(job.incomingDhlTrackingNumber || ""))
    || job.incomingDhlLastSix !== job.incomingDhlTrackingNumber.slice(-6)) {
    throw new Error("Eingehende DHL-Sendungsnummer ist ungueltig.");
  }
  if (typeof job.orderName !== "string" || job.orderName.length < 2 || /[\r\n]/.test(job.orderName)) {
    throw new Error("Shopify-Bestellname ist ungueltig.");
  }
  return job;
}

export function existingLabelEvidence(hrefs) {
  const labelUrls = new Set();
  const trackingNumbers = new Set();
  for (const rawHref of Array.isArray(hrefs) ? hrefs : []) {
    let url;
    try { url = new URL(String(rawHref)); } catch { continue; }
    if (url.origin === EASYDPD_FRAME_ORIGIN && /^\/labels\/\d+\/download\//.test(url.pathname)) {
      labelUrls.add(url.toString());
    }
    if (url.hostname === "tracking.dpd.de") {
      const match = url.pathname.match(/\/parcel\/(\d{11,20})(?:\/|$)/);
      if (match) trackingNumbers.add(match[1]);
    }
  }
  return {
    found: labelUrls.size > 0 || trackingNumbers.size > 0,
    labelCount: labelUrls.size,
    trackingNumbers: [...trackingNumbers],
  };
}

function filenameContainsOrder(filename, orderName) {
  const basename = String(filename || "").replaceAll("\\", "/").split("/").pop() || "";
  const orderToken = String(orderName || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const filenameToken = basename.toLowerCase().replace(/[^a-z0-9]/g, "");
  return orderToken.length >= 6 && filenameToken.includes(orderToken);
}

export function matchingDownloadedPdf(item, tabId, startedAt, orderName = "") {
  if (!item || String(item.filename || "").toLowerCase().endsWith(".pdf") !== true) return false;
  const sameTab = item.tabId === tabId;
  const sameOrder = filenameContainsOrder(item.filename, orderName);
  if (!sameTab && !sameOrder) return false;
  const start = Date.parse(String(item.startTime || ""));
  if (!Number.isFinite(start) || start < startedAt - 2_000) return false;
  const source = String(item.finalUrl || item.url || "");
  if (source.startsWith("blob:")) return true;
  try {
    const origin = new URL(source).origin;
    return origin === EASYDPD_FRAME_ORIGIN || (sameOrder && origin === SHOPIFY_ORIGIN);
  } catch {
    return false;
  }
}

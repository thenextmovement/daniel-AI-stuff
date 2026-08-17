(() => {
  "use strict";

  const FRAME_ORIGIN = "https://easydpd.247apps.de";
  const PURCHASE_KEY_PREFIX = "neontrip-easydpd-dispatched-job:";
  const PREPARE_READY_TIMEOUT_MS = 20_000;
  const PREPARE_READY_INTERVAL_MS = 250;
  const PRODUCT_LABELS = new Set([
    "B2C",
    "B2C Predict",
    "DPD Express 8:30",
    "DPD Express 12:00",
    "DPD Express 18:00",
  ]);

  if (location.origin !== FRAME_ORIGIN || globalThis.__neontripEasyDpdBridgeLoaded) return;
  globalThis.__neontripEasyDpdBridgeLoaded = true;

  function normalized(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function labelsFor(element) {
    const explicit = normalized(element.getAttribute("aria-label"));
    if (explicit) return explicit;
    return normalized([...element.labels || []].map((label) => label.textContent).join(" "));
  }

  function exactlyOne(items, description) {
    if (items.length !== 1) throw new Error(`${description} ist nicht eindeutig auffindbar.`);
    return items[0];
  }

  function selectWithOptions(requiredOptions, description) {
    const matches = [...document.querySelectorAll("select")].filter((element) => {
      const options = new Set([...element.options].map((option) => normalized(option.textContent)));
      return requiredOptions.every((entry) => options.has(entry));
    });
    return exactlyOne(matches, description);
  }

  function weightInput() {
    const matches = [...document.querySelectorAll('input[type="number"], input[role="spinbutton"]')]
      .filter((element) => /^Total (?:package weight|weight of the shipment)(?:\s+(?:g|gr))?$/i.test(labelsFor(element)));
    return exactlyOne(matches, "EasyDPD-Gesamtgewicht");
  }

  function createButton() {
    const matches = [...document.querySelectorAll("button")]
      .filter((element) => normalized(element.textContent) === "Create label");
    return exactlyOne(matches, "EasyDPD-Kaufbutton");
  }

  function orderLink(job) {
    const numericId = new URL(job.orderUrl).searchParams.get("id");
    const matches = [...document.querySelectorAll("a[href]")]
      .filter((element) => normalized(element.textContent) === job.orderName
        && new URL(element.href).origin === "https://admin.shopify.com"
        && new URL(element.href).pathname === `/store/galaxybuzzdk/orders/${numericId}`);
    return exactlyOne(matches, "EasyDPD-Bestellung");
  }

  function setNativeValue(element, value) {
    const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (!setter) throw new Error("EasyDPD-Eingabewert kann nicht gesetzt werden.");
    setter.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function selectLabel(element, label) {
    const option = [...element.options].find((entry) => normalized(entry.textContent) === label);
    if (!option) throw new Error(`EasyDPD-Auswahl fehlt: ${label}`);
    setNativeValue(element, option.value);
  }

  function currentLabel(element) {
    return normalized(element.selectedOptions?.[0]?.textContent);
  }

  function collectExistingLabelEvidence() {
    const labelUrls = [];
    const trackingNumbers = new Set();
    for (const anchor of document.querySelectorAll("a[href]")) {
      let url;
      try { url = new URL(anchor.href); } catch { continue; }
      if (url.origin === FRAME_ORIGIN && /^\/labels\/\d+\/download\//.test(url.pathname)) labelUrls.push(url.toString());
      if (url.hostname === "tracking.dpd.de") {
        const match = url.pathname.match(/\/parcel\/(\d{11,20})(?:\/|$)/);
        if (match) trackingNumbers.add(match[1]);
      }
    }
    return { found: labelUrls.length > 0 || trackingNumbers.size > 0, labelCount: labelUrls.length, trackingNumbers: [...trackingNumbers] };
  }

  function validateAndPrepare(job) {
    orderLink(job);
    if (!PRODUCT_LABELS.has(job.productLabel) || job.labelFormat !== "Einzeln auf A6" || job.packageWeightGrams !== 500) {
      throw new Error("Browser-Auftrag liegt ausserhalb der lokalen EasyDPD-Freigabe.");
    }
    const product = selectWithOptions(["B2C", "B2C Predict", "DPD Express 8:30", "DPD Express 12:00", "DPD Express 18:00"], "EasyDPD-Produkt");
    const format = selectWithOptions(["4 Labels auf A4", "Einzeln auf A6"], "EasyDPD-Format");
    const weight = weightInput();
    const button = createButton();
    const evidence = collectExistingLabelEvidence();
    if (evidence.found) return { ready: false, existingLabel: evidence };
    selectLabel(product, job.productLabel);
    selectLabel(format, job.labelFormat);
    setNativeValue(weight, String(job.packageWeightGrams));
    if (currentLabel(product) !== job.productLabel
      || currentLabel(format) !== job.labelFormat
      || Number(weight.value) !== job.packageWeightGrams
      || button.disabled
      || button.getAttribute("aria-disabled") === "true") {
      throw new Error("EasyDPD-Felder konnten nicht deterministisch vorbereitet werden.");
    }
    return {
      ready: true,
      existingLabel: evidence,
      observed: { orderName: normalized(orderLink(job).textContent), product: currentLabel(product), format: currentLabel(format), weightGrams: Number(weight.value) },
    };
  }

  function isTransientPreparationError(error) {
    return /^EasyDPD-(?:Bestellung|Produkt|Format|Gesamtgewicht|Kaufbutton) ist nicht eindeutig auffindbar[.]$/.test(
      String(error?.message || error),
    );
  }

  async function validateAndPrepareWhenReady(job) {
    const deadline = Date.now() + PREPARE_READY_TIMEOUT_MS;
    let lastError = null;
    do {
      try {
        return validateAndPrepare(job);
      } catch (error) {
        if (!isTransientPreparationError(error)) throw error;
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, PREPARE_READY_INTERVAL_MS));
      }
    } while (Date.now() < deadline);
    throw lastError || new Error("EasyDPD-Auftrag wurde nicht rechtzeitig kaufbereit.");
  }

  function purchaseOnce(job, dispatchNonce) {
    const prepared = validateAndPrepare(job);
    if (!prepared.ready || prepared.existingLabel.found) throw new Error("Vor dem Kauf wurde ein vorhandenes EasyDPD-Label erkannt.");
    const purchaseKey = `${PURCHASE_KEY_PREFIX}${job.id}`;
    const existing = sessionStorage.getItem(purchaseKey);
    if (existing) throw new Error("Dieser EasyDPD-Tab hat bereits einen Kauf-Dispatch erhalten; kein zweiter Klick.");
    sessionStorage.setItem(purchaseKey, JSON.stringify({ jobId: job.id, dispatchNonce, at: new Date().toISOString() }));
    createButton().click();
    return { clicked: true };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.target !== "neontrip-easydpd-frame") return undefined;
    if (message.action === "validate_and_prepare") {
      validateAndPrepareWhenReady(message.job)
        .then((result) => sendResponse({ ok: true, result }))
        .catch((error) => sendResponse({ ok: false, error: String(error?.message || error).slice(0, 500) }));
      return true;
    }
    try {
      if (message.action === "purchase_once") sendResponse({ ok: true, result: purchaseOnce(message.job, message.dispatchNonce) });
      else sendResponse({ ok: false, error: "Unbekannte EasyDPD-Bridge-Aktion." });
    } catch (error) {
      sendResponse({ ok: false, error: String(error?.message || error).slice(0, 500) });
    }
    return true;
  });
})();

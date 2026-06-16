import { chromium } from "playwright";

const now = "2026-06-16T12:00:00.000Z";

function baseUrl() {
  return String(process.env.CUSTOMER_SHIPPING_UI_BASE_URL || process.argv[2] || "http://localhost:3107")
    .trim()
    .replace(/\/+$/, "");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const board = {
  counts: {
    actionRequired: 1,
    watch: 1,
    labelCreated: 0,
    inTransit: 1,
    delivered: 0,
    returning: 0,
    stale: 0,
    withOpenTask: 0,
  },
  items: [
    {
      shipment: {
        id: "shipment-delivery-failed",
        shipmentKey: "shopify:fulfillment-1:TRACK-1",
        source: "shopify",
        shopifyOrderId: "1001",
        shopifyOrderNumber: "#1001",
        shopifyFulfillmentId: "fulfillment-1",
        requestId: "REQ-SHIP",
        customerName: "QA Kunde",
        customerEmail: "qa@example.test",
        customerPhone: null,
        carrier: "dpd",
        trackingNumber: "TRACK-1",
        trackingUrl: "https://tracking.example/track-1",
        destinationCountry: "DE",
        status: "delivery_failed",
        statusReason: null,
        riskLevel: "urgent",
        shippedAt: now,
        deliveredAt: null,
        lastEventAt: now,
        lastCarrierSyncAt: now,
        nextCheckAt: null,
        createdAt: now,
        updatedAt: now,
      },
      latestEvent: {
        id: "event-1",
        shipmentId: "shipment-delivery-failed",
        carrier: "dpd",
        trackingNumber: "TRACK-1",
        carrierEventId: "scan-1",
        eventKey: "dpd:TRACK-1:scan-1",
        carrierStatusCode: null,
        carrierStatusText: "Zustellung fehlgeschlagen",
        eventTime: now,
        eventLocation: "Berlin",
        normalizedStatus: "delivery_failed",
        mappingVersion: "qa",
        createdAt: now,
      },
      incidents: [
        {
          id: "incident-delivery-failed",
          shipmentId: "shipment-delivery-failed",
          requestId: "REQ-SHIP",
          incidentKey: "shipment-delivery-failed:delivery_failed",
          incidentType: "delivery_failed",
          severity: "urgent",
          status: "open",
          title: "Zustellung fehlgeschlagen",
          description: "DPD meldet fehlgeschlagene Zustellung.",
          firstDetectedAt: now,
          lastDetectedAt: now,
          resolvedAt: null,
          ruleVersion: "qa",
          sourceEventId: "event-1",
          activeTaskId: null,
          createdAt: now,
          updatedAt: now,
        },
      ],
    },
  ],
};

function dialogHandler(dialogs, action, accept) {
  return async (dialog) => {
    dialogs.push({ action, message: dialog.message() });
    if (accept) await dialog.accept();
    else await dialog.dismiss();
  };
}

async function main() {
  const target = baseUrl();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const posts = [];
  const dialogs = [];
  const pageErrors = [];
  const consoleErrors = [];

  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (msg) => {
    if (["error", "warning"].includes(msg.type())) consoleErrors.push(`${msg.type()}: ${msg.text()}`);
  });
  await page.route("**/api/ops/tasks**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, tasks: [] }) });
  });
  await page.route("**/api/ops/customer-records/shipping**", async (route) => {
    const request = route.request();
    if (request.method() === "POST") posts.push({ method: request.method(), body: request.postDataJSON() });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, board }) });
  });

  await page.goto(`${target}/ops/customer-records/shipping`, { waitUntil: "networkidle" });
  await page.getByText("#1001").waitFor({ timeout: 10_000 });
  await page.getByLabel("Request-ID Filter").fill("REQ-SHIP");
  await page.getByRole("button", { name: "Laden" }).click();
  await page.getByText("Zustellung fehlgeschlagen").first().waitFor();

  await page.getByRole("button", { name: "Aufgabe für Zustellung fehlgeschlagen anlegen" }).click();
  await page.getByText(/Aufgabe wurde angelegt/).waitFor();
  await page.getByRole("button", { name: "Incident Zustellung fehlgeschlagen als gesehen markieren" }).click();
  await page.getByText("Incident wurde als gesehen markiert.").waitFor();

  page.once("dialog", dialogHandler(dialogs, "dismiss-resolve", false));
  await page.getByRole("button", { name: "Incident Zustellung fehlgeschlagen als erledigt markieren" }).click();
  assert(posts.length === 2, `Abgebrochenes Erledigen sendet trotzdem POST: ${JSON.stringify({ posts, dialogs })}`);

  page.once("dialog", dialogHandler(dialogs, "accept-resolve", true));
  await page.getByRole("button", { name: "Incident Zustellung fehlgeschlagen als erledigt markieren" }).click();
  await page.getByText("Incident wurde erledigt.").waitFor();

  page.once("dialog", dialogHandler(dialogs, "dismiss-ignore", false));
  await page.getByRole("button", { name: "Incident Zustellung fehlgeschlagen ignorieren" }).click();
  assert(posts.length === 3, `Abgebrochenes Ignorieren sendet trotzdem POST: ${JSON.stringify({ posts, dialogs })}`);

  page.once("dialog", dialogHandler(dialogs, "accept-ignore", true));
  await page.getByRole("button", { name: "Incident Zustellung fehlgeschlagen ignorieren" }).click();
  await page.getByText("Incident wurde ignoriert.").waitFor();

  const mobileLayout = await page.evaluate(() => ({
    noHorizontalOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  assert(mobileLayout.noHorizontalOverflow, `Mobile horizontal overflow: ${mobileLayout.scrollWidth} > ${mobileLayout.clientWidth}`);
  assert(pageErrors.length === 0, `Page errors: ${pageErrors.join(" | ")}`);
  assert(consoleErrors.length === 0, `Console errors: ${consoleErrors.join(" | ")}`);

  await browser.close();
  console.log(JSON.stringify({
    ok: true,
    baseUrl: target,
    posts: posts.map((entry) => entry.body.action),
    dialogs,
    mobileLayout,
  }, null, 2));
}

main().catch((error) => {
  console.error(`Customer Shipping UI Smoke fehlgeschlagen: ${error.message}`);
  process.exit(1);
});

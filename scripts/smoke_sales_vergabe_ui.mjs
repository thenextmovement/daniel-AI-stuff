import { chromium } from "playwright";

const now = "2026-06-15T10:00:00.000Z";

function baseUrl() {
  return String(process.env.SALES_VERGABE_UI_BASE_URL || process.argv[2] || "http://127.0.0.1:3107")
    .trim()
    .replace(/\/+$/, "");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sale(overrides = {}) {
  const id = overrides.id || "sale-paid";
  return {
    id,
    saleKey: id,
    source: "qa",
    shopifyOrderId: `gid://shopify/Order/${id}`,
    shopifyOrderName: overrides.shopifyOrderName || `#QA-${id}`,
    shopifyOrderUrl: "https://admin.shopify.com/store/neontrip/orders/1",
    paymentLink: "https://pay.example/checkout",
    shopifyPaymentStatus: overrides.shopifyPaymentStatus || "paid",
    paymentDecisionStatus: overrides.paymentDecisionStatus || "paid_confirmed",
    paymentDueAt: null,
    lastPaymentReminderAt: null,
    paymentReminderCount: 0,
    offerId: "offer_qa",
    offerNumber: overrides.offerNumber || "NT-QA",
    documentReference: "DOC-QA",
    offerPublicUrl: "https://angebote.example/v/qa",
    finalPdfUrl: "https://angebote.example/qa.pdf",
    trelloCardId: "trello-source",
    sourceTrelloCardUrl: "https://trello.com/c/sourceqa",
    quentinTrelloBoardUrl: "https://trello.com/b/9QNAfkv4/quentin-neon-signs",
    quentinTrelloSearchUrl: "https://trello.com/search?q=%23QA%20board%3A62bae9b97705e7419ed64593",
    requestId: "request_qa",
    customerName: overrides.customerName || "QA Kunde",
    customerEmail: overrides.customerEmail || "qa@example.test",
    customerPhone: "+49 30 123",
    customerCompany: "QA GmbH",
    currency: "EUR",
    subtotalPrice: 420,
    totalPrice: 499,
    customerDueDate: "2026-06-20",
    supplierDueDate: overrides.supplierDueDate || "2026-06-18",
    dueDateSource: "customer",
    dueDateNote: null,
    recommendedSupplier: overrides.recommendedSupplier || "said",
    recommendationReasons: ["QA Regel"],
    assignedSupplier: overrides.assignedSupplier || null,
    specialSupplierName: overrides.specialSupplierName || null,
    assignmentStatus: overrides.assignmentStatus || "ready_to_assign",
    assignmentNote: null,
    assignedAt: null,
    assignedBy: null,
    shopifyTagSyncStatus: overrides.shopifyTagSyncStatus || "not_started",
    shopifyTagValue: null,
    shopifyTagSyncedAt: null,
    shopifyTagError: overrides.shopifyTagError || null,
    trelloProjectionStatus: overrides.trelloProjectionStatus || "not_started",
    supplierTrelloCardId: null,
    supplierTrelloCardUrl: "https://trello.com/c/qa",
    trelloProjectionError: overrides.trelloProjectionError || null,
    taskSyncStatus: overrides.taskSyncStatus || "not_started",
    activeTaskId: null,
    taskSyncError: overrides.taskSyncError || null,
    productSummary: overrides.productSummary || "LED Neon Sign 120cm, Outdoor, warmweiss",
    primaryImageUrl: null,
    rushOrder: Boolean(overrides.rushOrder),
    createdAt: now,
    updatedAt: now,
    items: [
      {
        id: `${id}-item`,
        saleId: id,
        lineItemKey: `${id}-line`,
        title: "LED Neon Sign",
        sku: "QA-LED",
        variantTitle: "120cm",
        description: "Freigegebene Kundenauswahl aus dem Angebots-Snapshot.",
        selectionDetails: ["Bereich: LED Neon", "Groesse: 120cm", "Farbe: warmweiss"],
        quantity: 1,
        productType: "LED Neon",
        imageUrl: null,
        requiresQuentin: false,
        ruleReasons: [],
        createdAt: now,
        updatedAt: now,
      },
    ],
    latestEvent: null,
    orderConfirmationEmail: null,
    postOrderReview: { status: "none", expiresAt: null, message: null },
    ...overrides,
  };
}

const paidSale = sale({ id: "sale-paid", offerNumber: "NT-PAID", customerName: "Bezahlter Kunde" });
const unpaidSale = sale({
  id: "sale-unpaid",
  offerNumber: "NT-UNPAID",
  customerName: "Offene Zahlung",
  customerEmail: "offen@example.test",
  shopifyPaymentStatus: "pending",
  paymentDecisionStatus: "pending",
  assignmentStatus: "payment_open",
  recommendedSupplier: "quentin",
});
const specialSale = sale({
  id: "sale-special",
  offerNumber: "NT-SPECIAL",
  customerName: "Sonder Supplier",
  recommendedSupplier: "special",
  specialSupplierName: "Laser Studio",
});
const rushSale = sale({
  id: "sale-rush",
  offerNumber: "NT-RUSH",
  customerName: "Express Kunde",
  productSummary: "Eilauftrag LED Neon Sign",
  rushOrder: true,
});
const syncFailedSale = sale({
  id: "sale-sync-failed",
  offerNumber: "NT-SYNC",
  customerName: "Sync Fehler",
  assignmentStatus: "assigned",
  assignedSupplier: "said",
  shopifyTagSyncStatus: "failed",
  trelloProjectionStatus: "synced",
  taskSyncStatus: "failed",
  shopifyTagError: "tag failed",
  taskSyncError: "task failed",
});

const board = {
  items: [paidSale, unpaidSale, specialSale, rushSale, syncFailedSale],
  counts: {
    total: 5,
    paidUnassigned: 3,
    readyToAssign: 3,
    paymentOpen: 1,
    assigned: 1,
    dueSoon: 4,
    overdue: 0,
    rushOrders: 1,
    quentinRecommended: 1,
    saidRecommended: 3,
    syncIssues: 1,
  },
  diagnostics: {
    ready: true,
    missing: [],
    items: [
      { key: "supabase", status: "ok", label: "Supabase", detail: "QA mock" },
      { key: "shopify", status: "ok", label: "Shopify", detail: "QA mock" },
      { key: "trello", status: "ok", label: "Trello", detail: "QA mock" },
      { key: "tasks", status: "ok", label: "Aufgaben", detail: "QA mock" },
    ],
  },
};

const taskPayload = {
  ok: true,
  tasks: [
    {
      id: "task-qa",
      sourceApp: "supplier_sales",
      sourceRef: "sale-unpaid",
      title: "QA Aufgabe pruefen",
      description: "Mock-Aufgabe",
      customerName: "Offene Zahlung",
      requestId: "request_qa",
      offerId: null,
      priority: "urgent",
      status: "open",
      assigneeLabel: "",
      dueAt: "2026-06-15T08:00:00.000Z",
      createdBy: "qa",
      completedAt: null,
      createdAt: now,
      updatedAt: now,
      metadata: {},
    },
  ],
};

function supplierSalesScopeResponse(page, scope) {
  return page.waitForResponse((response) => {
    if (!response.url().includes("/api/ops/supplier-sales")) return false;
    if (response.request().method() !== "GET") return false;
    return new URL(response.url()).searchParams.get("scope") === scope;
  });
}

function setupRoutes(page, posts) {
  return Promise.all([
    page.route("**/api/ops/tasks?**", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(taskPayload) });
    }),
    page.route("**/api/ops/tasks/*", async (route) => {
      posts.push({ url: route.request().url(), method: route.request().method(), body: route.request().postDataJSON() });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, task: { ...taskPayload.tasks[0], status: "done" } }),
      });
    }),
    page.route("**/api/ops/supplier-sales**", async (route) => {
      const request = route.request();
      if (request.method() !== "POST") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, board }) });
        return;
      }

      const body = request.postDataJSON();
      posts.push({ url: request.url(), method: request.method(), body });
      if (body.action === "create_deadline_tasks") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            board,
            deadlineTasks: { checked: 4, created: 1, skipped: 3, failed: 0, taskIds: ["task-new"], errors: [] },
          }),
        });
        return;
      }
      if (body.action === "diagnose_sales_flow") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            board,
            liveCheck: {
              status: "warning",
              checkedAt: now,
              offersFeed: { configured: true, checked: 2, failed: 0, warnings: [], errors: [] },
              latestCompletedOffers: [
                {
                  offerId: "offer-live-1",
                  offerNumber: "NT-LIVE-1",
                  documentReference: "AN-LIVE-1",
                  status: "COMPLETED",
                  acceptedAt: now,
                  updatedAt: now,
                  inVergabe: true,
                  supplierSale: {
                    saleId: "sale-paid",
                    source: "offers",
                    createdAt: now,
                    updatedAt: now,
                    assignmentStatus: "assigned",
                    shopifyTagSyncStatus: "synced",
                    shopifyOrderName: "#QA-sale-paid",
                  },
                },
                {
                  offerId: "offer-live-2",
                  offerNumber: "NT-LIVE-2",
                  documentReference: "AN-LIVE-2",
                  status: "COMPLETED",
                  acceptedAt: now,
                  updatedAt: now,
                  inVergabe: false,
                  supplierSale: null,
                },
              ],
              latestVergabeSales: [
                {
                  saleId: "sale-paid",
                  offerId: "offer-live-1",
                  offerNumber: "NT-LIVE-1",
                  documentReference: "AN-LIVE-1",
                  source: "offers",
                  createdAt: now,
                  updatedAt: now,
                  assignmentStatus: "assigned",
                  shopifyTagSyncStatus: "synced",
                  shopifyOrderName: "#QA-sale-paid",
                },
              ],
              missingOfferIds: ["offer-live-2"],
              sortCheck: {
                order: "created_at.desc,updated_at.desc",
                latestCompletedOfferId: "offer-live-1",
                newestVergabeOfferId: "offer-live-1",
                latestCompletedOfferInTopVergabe: true,
              },
            },
          }),
        });
        return;
      }

      const source = board.items.find((item) => item.id === body.saleId) || paidSale;
      const updatedSale = {
        ...source,
        assignedSupplier: body.supplier || source.assignedSupplier,
        assignmentStatus: body.action === "assign_supplier" ? "assigned" : source.assignmentStatus,
        paymentDecisionStatus: body.paymentDecisionStatus || source.paymentDecisionStatus,
        shopifyTagSyncStatus: body.action === "assign_supplier" ? "pending" : source.shopifyTagSyncStatus,
        trelloProjectionStatus: body.action === "assign_supplier" ? "synced" : source.trelloProjectionStatus,
        taskSyncStatus: body.action === "assign_supplier" ? "synced" : source.taskSyncStatus,
        orderConfirmationEmail: body.action === "send_order_confirmation_email"
          ? {
              status: "sent",
              recipientEmail: source.customerEmail,
              requestedAt: now,
              sentAt: now,
              requestedBy: body.operatorName || "QA",
              providerMessageId: "qa-outlook-message",
              error: null,
            }
          : source.orderConfirmationEmail || null,
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          board,
          sale: updatedSale,
          orderConfirmationEmail: body.action === "send_order_confirmation_email"
            ? { status: "sent", recipientEmail: source.customerEmail, providerMessageId: "qa-outlook-message", error: null }
            : undefined,
        }),
      });
    }),
  ]);
}

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
  await setupRoutes(page, posts);

  await page.goto(`${target}/ops/sales-vergabe`, { waitUntil: "networkidle" });
  await page.getByText("#QA-sale-unpaid").waitFor({ timeout: 10_000 });
  await page.getByText("Bezahlt offen").waitFor({ timeout: 10_000 });
  await page.getByText("Bezahlt - sofort vergeben").first().waitFor({ timeout: 10_000 });

  await Promise.all([
    supplierSalesScopeResponse(page, "ready"),
    page.getByRole("button", { name: "Bereite Sales anzeigen" }).click(),
  ]);
  await Promise.all([
    supplierSalesScopeResponse(page, "payment"),
    page.getByRole("button", { name: "Offene Zahlungen anzeigen" }).click(),
  ]);
  await Promise.all([
    supplierSalesScopeResponse(page, "assigned"),
    page.getByRole("button", { name: "Vergebene Sales anzeigen" }).click(),
  ]);
  await Promise.all([
    supplierSalesScopeResponse(page, "deadline"),
    page.getByRole("button", { name: "Deadline Sales anzeigen" }).click(),
  ]);
  await Promise.all([
    page.waitForResponse((response) => {
      if (!response.url().includes("/api/ops/supplier-sales")) return false;
      if (response.request().method() !== "GET") return false;
      return new URL(response.url()).searchParams.get("urgency") === "rush";
    }),
    page.getByRole("button", { name: "Eil- und Express-Auftraege anzeigen" }).click(),
  ]);
  await page.getByText("#QA-sale-rush").waitFor({ timeout: 10_000 });
  await page.getByLabel("Dringlichkeit filtern").selectOption("all");

  await page.getByLabel("Sales suchen").fill("#QA-sale-paid");
  await page.keyboard.press("Enter");
  await page.getByLabel("Bereich filtern").selectOption("sync");
  await page.getByLabel("Supplier filtern").selectOption("quentin");
  await page.getByLabel("Zahlungsstatus filtern").selectOption("unpaid");
  await page.getByText("#QA-sale-unpaid").waitFor({ timeout: 10_000 });

  const paidCard = page.locator("article").filter({ hasText: "#QA-sale-paid" });
  const unpaidCard = page.locator("article").filter({ hasText: "#QA-sale-unpaid" });
  const specialCard = page.locator("article").filter({ hasText: "#QA-sale-special" });

  assert(await paidCard.count() === 1, "paid sale card fehlt");
  assert(await unpaidCard.count() === 1, "unpaid sale card fehlt");
  assert(await specialCard.count() === 1, "special sale card fehlt");

  await unpaidCard.getByLabel("Zahlungsentscheidung").selectOption("wait_for_payment");
  assert(await unpaidCard.getByRole("button", { name: "Vergeben" }).isDisabled(), "Vergeben bleibt bei Warten nicht disabled");
  await unpaidCard.getByLabel("Zahlungsentscheidung").selectOption("manual_approved_unpaid");

  page.once("dialog", dialogHandler(dialogs, "dismiss-unpaid-assign", false));
  await unpaidCard.getByRole("button", { name: "Vergeben" }).click();
  assert(posts.length === 0, `Abgebrochene unbezahlte Vergabe sendet trotzdem POST: ${JSON.stringify({ posts, dialogs })}`);

  page.once("dialog", dialogHandler(dialogs, "accept-unpaid-assign", true));
  await unpaidCard.getByRole("button", { name: "Vergeben" }).click();
  assert(posts.length === 1 && posts[0].body.action === "assign_supplier", "Akzeptierte unbezahlte Vergabe sendet falsche Action");

  page.once("dialog", dialogHandler(dialogs, "dismiss-reminder", false));
  await unpaidCard.getByRole("button", { name: "Erinnerung" }).click();
  assert(posts.length === 1, "Abgebrochene Erinnerung sendet trotzdem POST");

  page.once("dialog", dialogHandler(dialogs, "accept-reminder", true));
  await unpaidCard.getByRole("button", { name: "Erinnerung" }).click();
  assert(posts.length === 2 && posts[1].body.action === "request_payment_reminder", "Akzeptierte Erinnerung sendet falsche Action");

  page.once("dialog", dialogHandler(dialogs, "dismiss-wait", false));
  await unpaidCard.getByRole("button", { name: "Warten" }).click();
  assert(posts.length === 2, "Abgebrochenes Warten sendet trotzdem POST");

  page.once("dialog", dialogHandler(dialogs, "accept-wait", true));
  await unpaidCard.getByRole("button", { name: "Warten" }).click();
  assert(posts.length === 3 && posts[2].body.action === "update_payment_decision", "Akzeptiertes Warten sendet falsche Action");

  page.once("dialog", dialogHandler(dialogs, "accept-paid-assign", true));
  await paidCard.getByRole("button", { name: "Vergeben" }).click();
  assert(posts.length === 4 && posts[3].body.action === "assign_supplier", "Bezahlte Vergabe sendet falsche Action");

  page.once("dialog", dialogHandler(dialogs, "dismiss-order-confirmation", false));
  await paidCard.getByRole("button", { name: "AB senden" }).click();
  assert(posts.length === 4, "Abgebrochene Auftragsbestaetigung sendet trotzdem POST");

  page.once("dialog", dialogHandler(dialogs, "accept-order-confirmation", true));
  await paidCard.getByRole("button", { name: "AB senden" }).click();
  assert(posts.length === 5 && posts[4].body.action === "send_order_confirmation_email", "Auftragsbestaetigung sendet falsche Action");

  await specialCard.getByLabel("Supplier auswaehlen").selectOption("special");
  assert(await specialCard.getByLabel("Name Sonder-Supplier").isVisible(), "Sonder-Supplier Eingabe ist nicht sichtbar");

  page.once("dialog", dialogHandler(dialogs, "dismiss-deadline", false));
  await page.getByRole("button", { name: "Deadline-Aufgaben pruefen" }).click();
  assert(posts.length === 5, "Abgebrochene Deadline-Pruefung sendet trotzdem POST");

  page.once("dialog", dialogHandler(dialogs, "accept-deadline", true));
  await page.getByRole("button", { name: "Deadline-Aufgaben pruefen" }).click();
  assert(posts.length === 6 && posts[5].body.action === "create_deadline_tasks", "Deadline-Pruefung sendet falsche Action");

  await page.getByRole("button", { name: "Live-Abgleich testen" }).click();
  await page.getByText("Live-Abgleich Angebote -> Produktion").waitFor();
  await page.getByText("AN-LIVE-2").waitFor();
  assert(posts.length === 7 && posts[6].body.action === "diagnose_sales_flow", "Live-Abgleich sendet falsche Action");

  page.once("dialog", dialogHandler(dialogs, "dismiss-task-done", false));
  await page.getByRole("button", { name: "Erledigt" }).click();
  assert(posts.length === 7, "Abgebrochene Aufgabe-Erledigt-Aktion sendet trotzdem PATCH");

  page.once("dialog", dialogHandler(dialogs, "accept-task-done", true));
  await page.getByRole("button", { name: "Erledigt" }).click();
  assert(posts.length === 8 && posts[7].method === "PATCH", "Akzeptierte Aufgabe-Erledigt-Aktion sendet keinen PATCH");

  const mobileLayout = await page.evaluate(() => ({
    noHorizontalOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  assert(mobileLayout.noHorizontalOverflow, `Mobile horizontal overflow: ${mobileLayout.scrollWidth} > ${mobileLayout.clientWidth}`);
  assert(pageErrors.length === 0, `Page errors: ${pageErrors.join(" | ")}`);

  const screenshotPath = process.env.SALES_VERGABE_UI_SCREENSHOT || "";
  if (screenshotPath) {
    await page.screenshot({ path: screenshotPath, fullPage: true });
  }

  await browser.close();
  console.log(JSON.stringify({ ok: true, baseUrl: target, posts: posts.map((entry) => entry.body?.action || entry.method), dialogs: dialogs.length, mobileLayout, consoleErrors }, null, 2));
}

main().catch((error) => {
  console.error(`Sales-Vergabe UI Smoke fehlgeschlagen: ${error.message}`);
  process.exit(1);
});

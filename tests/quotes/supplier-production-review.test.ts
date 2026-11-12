import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { defaultReviewApproval, renderProductionReview, reviewApprovalIssues, productionPriorityFromDeliveryTitles, QUENTIN_REVIEW_BOARD, PRODUCTION_LISTS, type ProductionReview } from "@/lib/ops/supplier-sale-review";
import { analyzeProductionReview, validateReviewAnalysis } from "@/lib/ops/supplier-sale-review-ai";
import { executeProductionHandoff, approvedDesignAttachmentName, type HandoffDependencies, type ProductionHandoff } from "@/lib/ops/supplier-sale-handoff";
import { readSupplierSaleMail } from "@/lib/ops/supplier-sale-mail";
import { backupSupplierFile, type SupplierFileBackup } from "@/lib/ops/supplier-sale-files";
import { supplierSaleVisibleInActiveOverview, supplierSaleReadyForProduction } from "@/lib/ops/supplier-sale-completion";
import { productionReviewItems, productionOrderHash, type SupplierSaleItemRow } from "@/lib/ops/supplier-sales";
import type { ProductionTrelloCard } from "@/lib/quotes/trello";

const bytes = new TextEncoder().encode("bought-image-content");
const hash = createHash("sha256").update(bytes).digest("hex");
function review(): ProductionReview {
  return {
    version: 1, id: "review-1", saleId: "11111111-1111-4111-8111-111111111111", preparedAt: "2026-11-12T10:00:00Z",
    sourceHash: "all", orderHash: "order", mailHash: "mail", cardHash: "card",
    orderName: "#NEONT-TEST", customerName: "Testkundin", requestId: "request-test",
    cardId: "aaaaaaaaaaaaaaaaaaaaaaaa", cardUrl: "https://trello.com/c/test",
    originalTitle: "KEY KUNDE | Test", originalDescription: "Cable Position: Bottom right",
    originalListId: "waiting", originalCoverId: "old", originalPos: 100,
    products: [{ id: "product-1", title: "LED Neon Sign", quantity: 1,
      fields: [{ label: "Size", value: "120 x 45 cm" }, { label: "Cable Position", value: "Top right" }],
      imageUrl: "https://angebote.neontrip.de/api/public/offers/secret/images/image1", imageId: "image1", imageTitle: "Final design", imageHash: hash }],
    accessories: ["4x Adhesive mounting set", "1x Additional 2 m cable length"],
    sources: [{ id: "card", kind: "card", label: "Karte", text: "Cable Position: Bottom right", at: null, href: null },
      { id: "mail:old", kind: "mail", threadId: "old-offer", label: "Früheres Angebot", text: "Bitte das Logo ohne den Punkt ausführen.", at: "2026-11-01T10:00:00Z", href: "https://outlook.office.com/test" }],
    analysis: { summary: "Kabelposition klären; Logoänderung aus dem vorherigen Angebot.",
      threads: [{ id: "old-offer", relevance: "related", reason: "Fortsetzung desselben Projekts." }],
      changes: [{ id: "cable", kind: "conflict", productId: "product-1", field: "Cable Position", value: "Bottom right", reason: "Kabelposition abweichend",
        evidence: [{ sourceId: "card", quote: "Cable Position: Bottom right" }] },
      { id: "logo", kind: "addition", productId: "product-1", field: "Additional Information", value: "Produce the logo without the dot.", reason: "Logoänderung bestätigt",
        evidence: [{ sourceId: "mail:old", quote: "Bitte das Logo ohne den Punkt ausführen." }] }] },
    attachments: [{ id: "old", name: "Old variant.pdf", url: "https://trello.com/file", mimeType: "application/pdf", previewUrl: null, decision: "undecided", reason: "Prüfen" }],
    priority: "standard", mailCount: 1, blockers: [],
  };
}
function approved(r = review()) {
  const a = defaultReviewApproval(r);
  a.decisions.cable = { action: "accept", note: "Bestätigte Kundenabsprache geprüft." };
  a.attachments.old = "remove"; a.confirmed = true;
  return Object.assign(a, renderProductionReview(r, a.decisions));
}
function harness(r = review()) {
  const card: ProductionTrelloCard = { id: r.cardId, idBoard: QUENTIN_REVIEW_BOARD, idList: r.originalListId, name: r.originalTitle, desc: r.originalDescription, pos: 100, closed: false, idAttachmentCover: "old",
    attachments: [{ id: "old", name: "Old variant.pdf", isUpload: true, bytes: bytes.length, url: "https://trello.com/file" }] };
  const state: ProductionHandoff = { reviewId: r.id, attemptKey: "attempt", approvalHash: "approved", status: "pending", error: null, uploads: {}, backups: [], releaseAttempted: false, verifiedAt: null };
  const calls: string[] = [];
  const backup: SupplierFileBackup = { attachmentId: "old", name: "Old variant.pdf", bucket: "customer-documents", path: "fixture", sha256: hash, byteSize: bytes.length, contentType: "application/pdf", verifiedAt: "now" };
  const deps: HandoffDependencies = {
    readCard: async () => structuredClone(card),
    upload: async (_url, name) => { calls.push("upload"); card.attachments.push({ id: "new", name, isUpload: true, bytes: bytes.length }); return { id: "new" }; },
    readFile: async () => ({ bytes, contentType: "image/png" }),
    backup: async () => { calls.push("backup"); return backup; },
    verifyBackup: async () => { calls.push("verify-backup"); return bytes; },
    update: async patch => { calls.push(patch.idList ? "release" : "content"); Object.assign(card, patch); if (patch.idList) card.pos = 1; },
    remove: async id => { calls.push("remove"); card.attachments = card.attachments.filter(a => a.id !== id); },
    verifyShopify: async () => { calls.push("shopify"); },
    checkSources: async () => { calls.push("fresh-sources"); },
    isTop: async () => true,
    save: async s => { calls.push("save:" + s.status); },
  };
  return { card, state, calls, deps };
}

test("one reviewed preview preserves KEY KUNDE, exact quantities and old-thread instruction", () => {
  const r = review(), a = approved(r);
  assert.deepEqual(reviewApprovalIssues(r, a), []);
  assert.match(a.title, /^KEY KUNDE \| #NEONT-TEST \| CHECK INFO/);
  assert.match(a.description, /^CHECK INFO\nProduct 1: Produce the logo without the dot/);
  assert.match(a.description, /Cable Position: Bottom right/);
  assert.match(a.description, /4x Adhesive mounting set/);
  assert.doesNotMatch(a.description, /8.*strip/i);
  assert.ok(reviewApprovalIssues(r, defaultReviewApproval(r)).some(s => s.includes("Entscheidung")));
  assert.ok(reviewApprovalIssues(r, { ...a, title: a.title + r.orderName }).length);
  assert.ok(reviewApprovalIssues(r, { ...a, decisions: { unknown: { action: "accept", note: "" } } }).length);
  assert.ok(reviewApprovalIssues(r, null as never).length);
});

test("multiple products keep separate backboard/letter dimensions and surface/light colors", () => {
  const r = review();
  r.products.push({ ...r.products[0], id: "product-2", title: "3D Sign", quantity: 2, fields: [
    { label: "Backboard Size", value: "200 x 110 cm" }, { label: "Letter Size", value: "164 x 73.7 cm" },
    { label: "Surface Color", value: "Black" }, { label: "Light Color", value: "Warm white" },
  ] });
  const a = approved(r);
  assert.match(a.description, /Product 2: 3D Sign\nBackboard Size: 200 x 110 cm\nLetter Size: 164 x 73.7 cm\nSurface Color: Black\nLight Color: Warm white\nQuantity: 2 Pieces/);
  assert.equal((a.description.match(/4x Adhesive/g) || []).length, 1);
  assert.equal(productionPriorityFromDeliveryTitles(["Standardlieferung"]), "standard");
  assert.equal(productionPriorityFromDeliveryTitles(["Expresslieferung 6 Tage"]), "express");
  assert.equal(productionPriorityFromDeliveryTitles(["kein Express"]), "standard");
});

test("model cannot omit a mail thread, invent numeric values, use unrelated mail, or hide card conflicts", () => {
  const r = review();
  assert.throws(() => validateReviewAnalysis({ ...r.analysis, threads: [] }, r.sources, r.products), /alle Mail/);
  const badNumber = structuredClone(r.analysis); badNumber.changes[1].value = "Use 8 adhesive strips.";
  assert.throws(() => validateReviewAnalysis(badNumber, r.sources, r.products), /unbelegte Zahlen/);
  const unrelated = structuredClone(r.analysis); unrelated.threads[0].relevance = "unrelated";
  assert.throws(() => validateReviewAnalysis(unrelated, r.sources, r.products), /nicht zugeordnet/);
  const omitted = validateReviewAnalysis({ ...r.analysis, changes: [] }, r.sources, r.products);
  assert.equal(omitted.changes[0].kind, "conflict");
  const misclassified = structuredClone(r.analysis);
  misclassified.changes[0].kind = "addition";
  misclassified.changes[0].value = "Top right";
  assert.equal(validateReviewAnalysis(misclassified, r.sources, r.products).changes.find(c => c.field === "Cable Position")?.kind, "conflict");
  r.sources[0].text = "CHECK INFO\nKeep original cable cover.\n\nLED Neon Sign\nSize: 120 x 45 cm";
  const notes = validateReviewAnalysis({ ...r.analysis, changes: [] }, r.sources, r.products);
  assert.ok(notes.changes.some(c => c.id === "preserve-card-instructions"));
});

test("one structured AI request excludes purchased-image tokens and source links", async () => {
  const old = process.env.OPS_OPENAI_API_KEY; process.env.OPS_OPENAI_API_KEY = "fixture";
  try {
    const r = review();
    await analyzeProductionReview({ products: r.products, sources: r.sources, orderReference: r.orderName, requestId: r.requestId }, async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      assert.equal(request.store, false); assert.equal(request.text.format.strict, true);
      assert.doesNotMatch(request.input, /secret|outlook.office.com/);
      assert.equal(request.tools, undefined);
      assert.deepEqual(request.text.format.schema.properties.threads.required, ["t1"]);
      assert.equal(request.reasoning.effort, "low");
      return Response.json({ status: "completed", output: [{ content: [{ type: "output_text", text: JSON.stringify({ summary: r.analysis.summary, threads: { t1: { relevance: "related", reason: "Fortsetzung" } }, changes: r.analysis.changes.map(c => ({ ...c, id: undefined, productId: "p1", questionOnly: false, evidence: c.evidence.map(e => JSON.parse(request.input).snippets.find((s: { id: string; text: string }) => s.text.includes(e.quote)).id) })) }) }] }] });
    });
  } finally { if (old === undefined) delete process.env.OPS_OPENAI_API_KEY; else process.env.OPS_OPENAI_API_KEY = old; }
});

test("release occurs only after verified backup, content, Shopify and fresh mail; cover matches purchased image", async () => {
  const r = review(), h = harness(r);
  await executeProductionHandoff(r, approved(r), h.state, h.deps);
  assert.equal(h.state.status, "synced");
  assert.equal(h.card.idAttachmentCover, "new");
  assert.equal(h.card.idList, PRODUCTION_LISTS.standard.id);
  assert.deepEqual(h.card.attachments.map(a => a.id), ["new"]);
  assert.ok(h.calls.indexOf("verify-backup") < h.calls.indexOf("remove"));
  assert.ok(h.calls.indexOf("shopify") < h.calls.indexOf("release"));
  assert.ok(h.calls.indexOf("fresh-sources") < h.calls.indexOf("release"));
  assert.equal(h.calls.filter(c => ["upload", "content", "remove", "release"].includes(c)).at(-1), "release");
});

test("failed backup never deletes or releases; late mail stops the release", async () => {
  const r = review(), h = harness(r);
  h.deps.verifyBackup = async () => { throw new Error("backup mismatch"); };
  await assert.rejects(executeProductionHandoff(r, approved(r), h.state, h.deps), /backup mismatch/);
  assert.ok(!h.calls.includes("remove")); assert.ok(!h.calls.includes("release")); assert.equal(h.state.status, "partial");
  const late = harness(r); late.deps.checkSources = async () => { throw new Error("Neue E-Mail"); };
  await assert.rejects(executeProductionHandoff(r, approved(r), late.state, late.deps), /Neue E-Mail/);
  assert.ok(!late.calls.includes("release"));
});

test("lost upload acknowledgement is reconciled by name plus bytes without duplicate upload", async () => {
  const r = review(), h = harness(r), upload = h.deps.upload;
  h.deps.upload = async (...args) => { await upload(...args); throw new Error("response lost"); };
  await assert.rejects(executeProductionHandoff(r, approved(r), h.state, h.deps), /response lost/);
  h.deps.upload = upload;
  await executeProductionHandoff(r, approved(r), h.state, h.deps);
  assert.equal(h.calls.filter(c => c === "upload").length, 1); assert.equal(h.state.status, "synced");
});

test("lost release acknowledgement is read back without moving again; external changes stop", async () => {
  const r = review(), h = harness(r), update = h.deps.update;
  h.deps.update = async patch => { await update(patch); if (patch.idList) throw new Error("response lost"); };
  await assert.rejects(executeProductionHandoff(r, approved(r), h.state, h.deps), /response lost/);
  h.deps.update = update;
  await executeProductionHandoff(r, approved(r), h.state, h.deps);
  assert.equal(h.calls.filter(c => c === "release").length, 1); assert.equal(h.state.status, "synced");
  const changed = harness(r); changed.card.desc = "New instruction";
  await assert.rejects(executeProductionHandoff(r, approved(r), changed.state, changed.deps), /bearbeitet/);
  assert.ok(!changed.calls.includes("upload"));
});

test("same-name wrong-image upload and unconfirmed top position cannot become successful", async () => {
  const r = review(), h = harness(r);
  h.card.attachments.push({ id: "new", name: approvedDesignAttachmentName(r.products[0].id, hash), isUpload: true });
  h.deps.readFile = async () => ({ bytes: new Uint8Array([1, 2]), contentType: "image/png" });
  await assert.rejects(executeProductionHandoff(r, approved(r), h.state, h.deps), /stimmt nicht/);
  const position = harness(r); position.deps.isTop = async () => false;
  await assert.rejects(executeProductionHandoff(r, approved(r), position.state, position.deps), /Position/);
  assert.equal(position.state.status, "partial");
});

test("partial reviewed handoff stays visible despite a Shopify tag and cannot be marked ready", () => {
  const sale = { assignmentStatus: "assigned", assignedSupplier: "quentin", shopifyTagSyncStatus: "synced", trelloProjectionStatus: "synced", supplierTrelloCardId: "card", supplierTrelloCardUrl: null, productionConfirmedAt: null, manualShopifySupplierTagConfirmedAt: null, productionReviewStatus: "partial" };
  assert.equal(supplierSaleVisibleInActiveOverview(sale), true);
  assert.equal(supplierSaleReadyForProduction(sale), false);
});

test("private existing storage verifies byte identity, including duplicate uploads", async () => {
  const before = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
  process.env.SUPABASE_URL = "https://storage.example"; process.env.SUPABASE_SERVICE_ROLE_KEY = "fixture";
  const input = { saleId: review().saleId, cardId: "aaaaaaaaaaaaaaaaaaaaaaaa", attachmentId: "bbbbbbbbbbbbbbbbbbbbbbbb", name: "design.pdf", contentType: "application/pdf", bytes };
  const mock = (publicBucket = false, corrupt = false): typeof fetch => async (url, init) => {
    if (String(url).includes("/bucket/")) return Response.json({ id: "customer-documents", public: publicBucket });
    if (init?.method === "POST") { assert.equal(new Headers(init.headers).get("x-upsert"), "false"); return new Response("", { status: 409 }); }
    return new Response(corrupt ? "different" : bytes);
  };
  try {
    const saved = await backupSupplierFile(input, mock()); assert.equal(saved.sha256, hash);
    await assert.rejects(backupSupplierFile(input, mock(true)), /private Ablage/);
    await assert.rejects(backupSupplierFile(input, mock(false, true)), /bytegleich/);
  } finally {
    if (before.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = before.url;
    if (before.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = before.key;
  }
});

test("mail reader includes full incoming/outgoing bodies, pagination and unindexed recent threads", async () => {
  const old = process.env.MICROSOFT_GRAPH_MAILBOX; process.env.MICROSOFT_GRAPH_MAILBOX = "support@neontrip.de";
  const msg = (id: string, thread: string, from = "customer@example.test") => ({ id, conversationId: thread, internetMessageId: `<${id}@example.test>`, subject: "Änderung", body: { contentType: "text", content: "Vollständiger Inhalt " + id }, receivedDateTime: "2026-11-12T09:00:00Z", sentDateTime: "2026-11-12T09:00:00Z", from: { emailAddress: { address: from } }, toRecipients: [{ emailAddress: { address: from === "support@neontrip.de" ? "customer@example.test" : "support@neontrip.de" } }] });
  const calls: URL[] = [];
  const fetcher: typeof fetch = async url => {
    const u = new URL(String(url)); calls.push(u);
    if (u.searchParams.has("$search")) return Response.json({ value: [{ ...msg("in", "old"), id: "mutable-in", body: undefined }], "@odata.nextLink": u.origin + decodeURIComponent(u.pathname) + "?page=2" });
    if (u.searchParams.has("page")) return Response.json({ value: [{ ...msg("out", "old", "support@neontrip.de"), id: "mutable-out", body: undefined }] });
    const filter = u.searchParams.get("$filter") || "";
    return Response.json({ value: filter.startsWith("receivedDateTime") ? [{ ...msg("fresh", "new"), body: undefined }] : filter.includes("'new'") ? [msg("fresh", "new")] : [msg("in", "old"), msg("out", "old", "support@neontrip.de")] });
  };
  try {
    const result = await readSupplierSaleMail({ email: "customer@example.test", requestId: null }, { token: async () => "fixture", fetch: fetcher });
    assert.equal(result.length, 3); assert.equal(result.find(m => m.id === "out")?.direction, "outbound");
    assert.equal(result.find(m => m.id === "in")?.body, "Vollständiger Inhalt in");
    assert.ok(calls.some(u => u.searchParams.get("$select")?.includes("body")));
    assert.ok(calls.filter(u => u.searchParams.has("$search") || u.searchParams.get("$filter")?.startsWith("receivedDateTime")).every(u => !u.searchParams.get("$select")?.split(",").includes("body")));
    assert.ok(calls.filter(u => u.searchParams.get("$filter")?.startsWith("conversationId")).every(u => u.searchParams.get("$top") === "25"));
    assert.ok(calls.some(u => u.searchParams.get("$filter")?.includes("'new'")));
    await assert.rejects(readSupplierSaleMail({ email: "customer@example.test", requestId: null }, { token: async () => "fixture", fetch: async () => Response.json({ value: [], "@odata.nextLink": "https://evil.example/messages" }) }), /Seitenlink/);
    await assert.rejects(readSupplierSaleMail({ email: "customer@example.test", requestId: null }, { token: async () => "fixture", fetch: async () => Response.json({ value: [{ ...msg("missing", "old"), body: undefined }] }) }), /Volltext fehlt/);
    for (const mismatch of ["missing", "other-thread"]) {
      await assert.rejects(readSupplierSaleMail({ email: "customer@example.test", requestId: null }, { token: async () => "fixture", fetch: async url => {
        const threadRead = new URL(String(url)).searchParams.get("$filter")?.startsWith("conversationId");
        return Response.json({ value: threadRead ? mismatch === "missing" ? [] : [{ ...msg("in", "other"), id: "immutable-in" }] : [msg("in", "old")] });
      } }), /Nicht alle gefundenen/);
    }
  } finally { if (old === undefined) delete process.env.MICROSOFT_GRAPH_MAILBOX; else process.env.MICROSOFT_GRAPH_MAILBOX = old; }
});

test("mail reader retries only transient reads and keeps nextLink bound to the support mailbox", async () => {
  const old = process.env.MICROSOFT_GRAPH_MAILBOX; process.env.MICROSOFT_GRAPH_MAILBOX = "support@neontrip.de";
  try {
    let calls = 0;
    const fetcher: typeof fetch = async (_url, init) => {
      assert.equal(init?.method, undefined); // GET only; no resend or mutation.
      calls++;
      if (calls === 1) return new Response(null, { status: 500, headers: { "Retry-After": "0" } });
      if (calls === 2) throw new DOMException("fixture timeout", "TimeoutError");
      return Response.json({ value: [] });
    };
    assert.deepEqual(await readSupplierSaleMail({ email: "customer@example.test", requestId: null }, { token: async () => "fixture", fetch: fetcher }), []);
    assert.equal(calls, 4);
    for (const status of [403, 500, 429]) {
      calls = 0;
      await assert.rejects(readSupplierSaleMail({ email: "customer@example.test", requestId: null }, { token: async () => "fixture", fetch: async () => {
        calls++; return new Response(null, { status, headers: { "Retry-After": status === 429 ? "60" : "0" } });
      } }), status === 429 ? /ausgelastet/ : /HTTP/);
      assert.equal(calls, status === 500 ? 3 : 1);
    }
    for (const next of ["https://graph.microsoft.com/v1.0/users/other@example.test/messages", "https://graph.microsoft.com/v1.0/users/support@neontrip.de/events", "https://evil.example/v1.0/users/support@neontrip.de/messages", "https://user:pass@graph.microsoft.com/v1.0/users/support@neontrip.de/messages"]) {
      calls = 0;
      await assert.rejects(readSupplierSaleMail({ email: "customer@example.test", requestId: null }, { token: async () => "fixture", fetch: async () => {
        calls++; return Response.json({ value: [], "@odata.nextLink": next });
      } }), /Seitenlink/);
      assert.equal(calls, 1);
    }
  } finally { if (old === undefined) delete process.env.MICROSOFT_GRAPH_MAILBOX; else process.env.MICROSOFT_GRAPH_MAILBOX = old; }
});



test("accepted image survives Shopify replacement through exact Offer Item ID, without hiding order changes", () => {
  const snapshot = { lineItems: [{ id: "accepted-product", title: "Sign", quantity: 1, section: "Lightbox", description: "Size: 70 x 44cm", purchasedImageId: "bought", purchasedImageUrl: "https://angebote.neontrip.de/bought" }] };
  const item = { id: "volatile-db-row", line_item_key: "shopify:1", quantity: 1, title: "Sign", product_type: null, raw_line_item: { id: "gid://shopify/LineItem/1", properties: [{ name: "Offer Item ID", value: "accepted-product" }, { name: "Beschreibung", value: "Size: 80 x 44cm" }] } } as unknown as SupplierSaleItemRow;
  const result = productionReviewItems(snapshot, [item]);
  assert.equal(result[0].id, "accepted-product"); assert.equal(result[0].product_type, "Lightbox");
  assert.equal(result[0].raw_line_item.purchasedImageId, "bought");
  assert.equal(result[0].raw_line_item.description, "Size: 80 x 44cm");
  assert.throws(() => productionReviewItems(snapshot, [{ ...item, quantity: 2 }]), /Menge/);
  assert.throws(() => productionReviewItems(snapshot, [item, { ...item, id: "duplicate" }]), /eindeutig/);
  assert.throws(() => productionReviewItems(snapshot, []), /entfernt/);
  assert.throws(() => productionReviewItems(snapshot, [{ ...item, raw_line_item: { id: "new-item" } }]), /eindeutig/);
  const row = { metadata: {}, offer_snapshot: snapshot } as never;
  assert.equal(productionOrderHash(row, [item]), productionOrderHash(row, [{ ...item, id: "replacement-db-row" }]));
  assert.notEqual(productionOrderHash(row, [item]), productionOrderHash(row, [{ ...item, quantity: 2 }]));
});

test("bold UPDATE and Additional Information survive; placeholders and equivalent spelling do not add conflicts", () => {
  const r = review(); r.sources = [{ ...r.sources[0], text: "**Additional Information:**\n\n**UPDATE: NEW EPS File attached**\n**Front painted in RAL 3020**\nSize: As Logo\n**Cable Output: Right Bottom**" }];
  const a = validateReviewAnalysis({ summary: "Geprüft", changes: [], threads: [] }, r.sources, r.products);
  assert.ok(a.changes.some(c => c.value.includes("NEW EPS")));
  assert.ok(a.changes.some(c => c.value.includes("RAL 3020")));
  assert.ok(a.changes.some(c => c.field === "Cable Position"));
  assert.ok(!a.changes.some(c => c.field === "Size"));
  r.sources[0].text = "Size: 120x45cm";
  assert.equal(validateReviewAnalysis({ summary: "Geprüft", changes: [], threads: [] }, r.sources, r.products).changes.length, 0);
});

test("source choices need a click, open questions need a documented result and never replace a field", () => {
  const r = review(), a = approved(r); a.decisions.cable.note = "";
  assert.deepEqual(reviewApprovalIssues(r, a), []);
  assert.ok(reviewApprovalIssues(r, { ...a, confirmed: false }).some(v => v.includes("bestätigen")));
  const bad = structuredClone(r.analysis); bad.changes[0].value = "Confirm cable position?";
  assert.throws(() => validateReviewAnalysis(bad, r.sources, r.products), /offene Frage/);
  bad.changes[0].questionOnly = true;
  r.analysis = validateReviewAnalysis(bad, r.sources, r.products);
  assert.equal(r.analysis.changes[0].value, "");
  assert.match(renderProductionReview(r, a.decisions).description, /Cable Position: Top right/);
  assert.ok(reviewApprovalIssues(r, a).some(v => v.includes("Klärung")));
  const release = structuredClone(r.analysis); release.changes[0].field = "ProductionRelease";
  assert.throws(() => validateReviewAnalysis(release, r.sources, r.products), /Unzulässiges/);
});


test("obsolete old values cannot delete bought fields; rejected obsolete notes are retained", () => {
  const r = review(); r.analysis.changes = [{ id: "old-size", kind: "obsolete", productId: "product-1", field: "Size", value: "As Logo", reason: "Ersetzt", evidence: [{ sourceId: "card", quote: "Cable Position: Bottom right" }] }, { id: "old-note", kind: "obsolete", productId: null, field: "Additional Information", value: "Keep original cable cover.", reason: "Prüfen", evidence: [{ sourceId: "card", quote: "Cable Position: Bottom right" }] }];
  const text = renderProductionReview(r, { "old-size": { action: "accept", note: "" }, "old-note": { action: "reject", note: "" } });
  assert.match(text.description, /Size: 120 x 45 cm/);
  assert.match(text.description, /Keep original cable cover/);
});


test("equivalent dimensions and light colors do not become manual conflicts", () => {
  const r = review(); r.products[0].fields = [{ label: "Size", value: "160 × 41,7 cm (1600 × 417 mm)" }, { label: "Backboard", value: "Einzelne Buchstaben" }, { label: "Color", value: "Kaltweiß + Rot" }];
  r.sources = [{ ...r.sources[0], text: "Size: 160 x 41.7cm\nBackboard: Loose letters\nColor: Red + Coolwhite" }];
  assert.equal(validateReviewAnalysis({ summary: "Geprüft", changes: [], threads: [] }, r.sources, r.products).changes.length, 0);
  r.sources[0].text = "Size: 160 x 42cm";
  assert.equal(validateReviewAnalysis({ summary: "Geprüft", changes: [], threads: [] }, r.sources, r.products).changes[0].kind, "conflict");
});

test("uncertain mail requires explicit exclusion or documented review when linked", () => {
  const r = review(), a = approved(r); r.analysis.threads = [{ id: "older", relevance: "uncertain", reason: "Andere Bestellung?" }];
  assert.ok(reviewApprovalIssues(r, a).some(s => s.includes("Mailzuordnung")));
  a.decisions["thread:older"] = { action: "reject", note: "" };
  assert.deepEqual(reviewApprovalIssues(r, a), []);
  a.decisions["thread:older"].action = "accept";
  assert.ok(reviewApprovalIssues(r, a).some(s => s.includes("Mailzuordnung")));
});

test("model cannot add an unsupported mounting template or invent quoted logo wording", () => {
  const r = review(); const bad = structuredClone(r.analysis);
  bad.changes[1].value = "Include mounting template.";
  assert.throws(() => validateReviewAnalysis(bad, r.sources, r.products), /nicht belegte Montageschablone/);
  bad.changes[1].value = 'Use logo wording "Completely different brand".';
  assert.throws(() => validateReviewAnalysis(bad, r.sources, r.products), /Wortlaut oder Dateiname/);
});


test("literal logo corrections from a related customer thread survive an omitted model finding", () => {
  const r = review(); r.sources[1].label = "Eingang: Früheres Angebot";
  r.sources[1].text = 'Das alte Logo ist angekommen. Für das zweite Logo bitte ein Angebot, indem „Alpha. Beta.“ gezeigt wird und nicht „Alpha- Beta-“.';
  const analysis = validateReviewAnalysis({ ...r.analysis, changes: [] }, r.sources, r.products);
  const correction = analysis.changes.find(c => c.id.startsWith("mail-literal-"));
  assert.equal(correction?.value, 'Use exactly "Alpha. Beta." instead of "Alpha- Beta-" in the logo.');
  r.analysis = analysis; const a = defaultReviewApproval(r);
  assert.match(a.description, /Alpha\. Beta\./);
  const unrelated = validateReviewAnalysis({ ...r.analysis, changes: [], threads: [{ id: "old-offer", relevance: "unrelated", reason: "Anderes Projekt" }] }, r.sources, r.products);
  const unlinked = unrelated.changes.find(c => c.id.startsWith("mail-literal-"));
  assert.equal(unlinked?.kind, "conflict"); assert.equal(unlinked?.requiresThreadId, "old-offer");
  r.analysis = unrelated; const approval = { ...defaultReviewApproval(r), confirmed: true }; approval.attachments.old = "keep"; approval.decisions[unlinked!.id] = { action: "accept", note: "" };
  assert.ok(reviewApprovalIssues(r, approval).some(v => v.includes("ausdrücklich zugeordnet")));
  approval.decisions["thread:old-offer"] = { action: "accept", note: "Quelle geprüft, gehört dazu" };
  assert.ok(!reviewApprovalIssues(r, approval).some(v => v.includes("ausdrücklich zugeordnet")));
});

test("an unresolved production detail stays a mandatory question even inside an addition", () => {
  const r = review(); const proposed = structuredClone(r.analysis);
  proposed.changes[1].value = "Mounting positions require clarification with the customer.";
  const analysis = validateReviewAnalysis(proposed, r.sources, r.products);
  assert.ok(analysis.changes.some(c => c.id === "unresolved-production-detail" && c.questionOnly));
});

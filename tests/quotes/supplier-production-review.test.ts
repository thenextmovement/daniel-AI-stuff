import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { defaultReviewApproval, renderProductionReview, reviewApprovalIssues, productionPriorityFromDeliveryTitles, QUENTIN_REVIEW_BOARD, PRODUCTION_LISTS, designMappingQuestions, confirmPurchasedDesigns, openImageVariants, decideImageVariants, reviewAttachmentLabel, reviewOpenStepCount, type ProductionReview } from "@/lib/ops/supplier-sale-review";
import { analyzeProductionReview, validateReviewAnalysis } from "@/lib/ops/supplier-sale-review-ai";
import { executeProductionHandoff, approvedDesignAttachmentName, type HandoffDependencies, type ProductionHandoff } from "@/lib/ops/supplier-sale-handoff";
import { readSupplierSaleMail, readSupplierSaleMailPdfs } from "@/lib/ops/supplier-sale-mail";
import { deliveryAddressMatches, validateDocumentFindings, guardDrawingRemoval, guardDrawingDimensions, omitRedundantDocumentQuestions, mailDocumentSourcesMatch } from "@/lib/ops/supplier-sale-documents";
import { confirmDocumentSuggestions, openDocumentSuggestions, confirmDeliveryNote, reviewedDeliveryNote, drawingReviewRecommendation, drawingSizeUpdate, confirmDrawingSizeUpdate, type ReviewDocument } from "@/lib/ops/supplier-sale-review";
import { renderPdfPagesToPng } from "@/lib/ops/arrival-labels/pdf";
import { PDFDocument } from "pdf-lib";
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

test("proven new inquiry stabilizes historical threads while reused threads and current references stay active", async () => {
  const oldKey = process.env.OPS_OPENAI_API_KEY; process.env.OPS_OPENAI_API_KEY = "fixture";
  try {
    const inquiry = "Ich habe eine neue Anfrage für zwei Schilder mit unserem neuen Logo. Bitte die beiden unterschiedlichen Texte nach den beigefügten Designs anbieten.";
    const r = review();
    const mail = (id: string, threadId: string, at: string | null, text: string, label = "Eingang: Anfrage") => ({ id, kind: "mail" as const, label, threadId, at, text, href: null });
    const sources = [
      { ...r.sources[0], text: "Original Nachricht (Outlook):\nHallo,\n\n" + inquiry },
      mail("past", "past-thread", "2026-11-01T10:00:00Z", "HISTORICAL-ONLY Lieferschein bitte mitsenden."),
      mail("inquiry", "new-thread", "2026-11-10T10:00:00Z", inquiry),
      mail("reused-old", "reused-thread", "2026-11-01T10:00:00Z", "REUSED-OLD Vollständige ältere Projektdetails."),
      mail("reused-new", "reused-thread", "2026-11-11T10:00:00Z", "Für das neue Logo bitte den Kabelausgang prüfen."),
      mail("undated", "undated-thread", null, "UNDATED darf nicht zeitlich ausgeschlossen werden."),
      mail("exact", "exact-thread", "2026-11-01T10:00:00Z", "EXACT aktuelle Referenz trotz früherem Datum.", "Eingang: A/N 16164"),
    ];
    for (const modelChoice of ["uncertain", "related", "unrelated"] as const) {
      const result = await analyzeProductionReview({ products: r.products, sources, orderReference: "#NEONT4857", offerReference: "A/N 16164", requestId: r.requestId }, async (_url, init) => {
        const body = JSON.parse(String(init?.body)), input = JSON.parse(body.input);
        assert.ok(!input.snippets.some((s: {text: string}) => s.text.includes("HISTORICAL-ONLY")));
        for (const text of ["REUSED-OLD", "UNDATED", "EXACT"]) assert.ok(input.snippets.some((s: {text: string}) => s.text.includes(text)));
        assert.deepEqual(body.text.format.schema.properties.threads.properties.t1.properties.relevance.enum, ["unrelated"]);
        return Response.json({ status: "completed", output: [{ content: [{ type: "output_text", text: JSON.stringify({ threads: Object.fromEntries(body.text.format.schema.properties.threads.required.map((id: string) => [id, { relevance: modelChoice, reason: "Schwankender Modellvorschlag" }])), changes: [] }) }] }] });
      });
      assert.equal(result.threads.find(t => t.id === "past-thread")?.relevance, "unrelated");
      assert.equal(result.threads.find(t => t.id === "new-thread")?.relevance, "related");
      assert.equal(result.threads.find(t => t.id === "exact-thread")?.relevance, "related");
      assert.equal(result.threads.find(t => t.id === "reused-thread")?.relevance, modelChoice);
      assert.equal(result.threads.find(t => t.id === "undated-thread")?.relevance, modelChoice);
      assert.ok(!result.changes.some(c => /delivery note/.test(c.value)));
    }
  } finally { if (oldKey === undefined) delete process.env.OPS_OPENAI_API_KEY; else process.env.OPS_OPENAI_API_KEY = oldKey; }
});

test("history exclusion requires an unambiguous verbatim NEW inquiry, and literal older corrections still surface", async () => {
  const oldKey = process.env.OPS_OPENAI_API_KEY; process.env.OPS_OPENAI_API_KEY = "fixture";
  try {
    const inquiry = "Ich habe eine neue Anfrage für ein weiteres Schild mit unserem neuen Logo und einer anderen Ausführung. Bitte ein Angebot anhand der Datei erstellen.";
    for (const scenario of ["no-match", "quoted-only", "ambiguous", "revision", "literal-correction"]) {
      const r = review();
      const inquiryText = scenario === "revision" ? inquiry.replace("neue Anfrage für ein weiteres Schild", "Rückfrage zum bestehenden Schild") : inquiry;
      const sources = [
        { ...r.sources[0], text: "Original Nachricht (Outlook):\n" + inquiryText },
        { ...r.sources[1], id: "past", threadId: "past", label: "Eingang: Früherer Verlauf", text: scenario === "literal-correction" ? 'Für das Logo bitte "Alpha. Beta." und nicht "Alpha- Beta-" verwenden.' : "HISTORY-MUST-REMAIN frühere Angaben.", at: "2026-11-01T10:00:00Z" },
        { ...r.sources[1], id: "new", threadId: "new", label: "Eingang: Anfrage", text: scenario === "no-match" ? "Anderer Inhalt" : scenario === "quoted-only" ? "Danke.\n\nVon: Jemand\n" + inquiryText : inquiryText, at: "2026-11-10T10:00:00Z" },
        ...(scenario === "ambiguous" ? [{ ...r.sources[1], id: "second", threadId: "second", label: "Eingang: Anfrage", text: inquiryText, at: "2026-11-10T11:00:00Z" }] : []),
      ];
      const result = await analyzeProductionReview({ products: r.products, sources, orderReference: r.orderName, requestId: r.requestId }, async (_url, init) => {
        const body = JSON.parse(String(init?.body)), input = JSON.parse(body.input);
        if (scenario !== "literal-correction") assert.ok(input.snippets.some((s: {text: string}) => s.text.includes("HISTORY-MUST-REMAIN")), scenario);
        return Response.json({ status: "completed", output: [{ content: [{ type: "output_text", text: JSON.stringify({ threads: Object.fromEntries(body.text.format.schema.properties.threads.required.map((id: string) => [id, { relevance: "uncertain", reason: "Bezug offen" }])), changes: [] }) }] }] });
      });
      assert.equal(result.threads.find(t => t.id === "past")?.relevance, "uncertain", scenario);
      if (scenario === "literal-correction") assert.ok(result.changes.some(c => c.requiresThreadId === "past" && /Alpha/.test(c.value)));
    }
  } finally { if (oldKey === undefined) delete process.env.OPS_OPENAI_API_KEY; else process.env.OPS_OPENAI_API_KEY = oldKey; }
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

test("mail enumeration cannot assign texts to purchased products, even with reordered product arrays", () => {
  for (const reverse of [false, true]) {
    const r = review();
    r.products = [
      { ...r.products[0], id: "red-tag", imageId: "image-red", imageTitle: "Mockup-A.jpg", fields: [] },
      { ...r.products[0], id: "contractor", imageId: "image-contractor", imageTitle: "Mockup-B.jpg", fields: [] },
    ];
    if (reverse) r.products.reverse();
    r.sources = [{ ...r.sources[1], label: "Eingang: Bestellung", text: 'Zwei Schilder: "contractor point", "red-tag area", jeweils eins.' }];
    const changes = r.products.map((p, i) => ({ id: `guess-${i}`, kind: "addition" as const, productId: p.id,
      field: "Additional Information", value: `Logo text: "${i ? "red-tag area" : "contractor point"}"`, reason: "Text aus Mail",
      evidence: [{ sourceId: r.sources[0].id, quote: r.sources[0].text }] }));
    r.analysis = validateReviewAnalysis({ ...r.analysis, changes: structuredClone(changes) }, r.sources, r.products);
    assert.ok(r.analysis.changes.every(c => c.questionOnly && c.productId === null && !c.value));
    const a = defaultReviewApproval(r);
    assert.doesNotMatch(a.description, /contractor point|red-tag area/);
    assert.ok(reviewApprovalIssues(r, a).some(issue => issue.includes("Produktzuordnung")));
    assert.equal(r.products.find(p => p.id === "red-tag")?.imageId, "image-red");
    assert.equal(r.products.find(p => p.id === "contractor")?.imageId, "image-contractor");
    const acceptedSource = { id: "order:red-tag", kind: "order" as const, label: "Gekauft", text: 'Text: "red-tag area"', at: null, href: null };
    const bound = validateReviewAnalysis({ summary: "Bestellt", threads: [], changes: [{ ...changes[0], productId: "red-tag", value: 'Logo text: "red-tag area"', evidence: [{ sourceId: acceptedSource.id, quote: acceptedSource.text }] }] }, [acceptedSource], r.products);
    assert.equal(bound.changes[0].kind, "addition");
    assert.equal(bound.changes[0].productId, "red-tag");
  }
});

test("explicit delivery-note instruction survives omission while attachment and address require review", () => {
  const r = review();
  r.sources = [{ ...r.sources[1], label: "Eingang: Angebot", text: "Anbei findest du den Lieferschein mit der Lieferadresse, bitte mitsenden." }];
  r.analysis = validateReviewAnalysis({ ...r.analysis, changes: [] }, r.sources, r.products);
  const a = defaultReviewApproval(r);
  assert.match(a.description, /Include the customer's delivery note with the shipment/);
  assert.ok(r.analysis.changes.some(c => c.questionOnly && /Lieferadresse/.test(c.reason)));
  assert.ok(reviewApprovalIssues(r, a).some(issue => /Lieferschein/.test(issue)));
  assert.equal(r.analysis.changes.filter(c => c.kind === "addition").length, 1);
  assert.doesNotMatch(a.description, /address.*verified|Lieferadresse/);
});

test("a free-form delivery-note question cannot suppress the document reader's canonical check", () => {
  const r = review();
  r.sources = [{ ...r.sources[1], label: "Eingang: Angebot", text: "Anbei findest du den Lieferschein mit der Lieferadresse, bitte mitsenden." }];
  r.analysis = validateReviewAnalysis({ ...r.analysis, changes: [{ id: "question", kind: "conflict", questionOnly: true,
    productId: null, field: "Additional Information", value: "", reason: "Bitte Lieferschein und Lieferadresse prüfen.",
    evidence: [{ sourceId: r.sources[0].id, quote: r.sources[0].text }] }] }, r.sources, r.products);
  assert.equal(r.analysis.changes.filter(c => c.id === "check-delivery-note").length, 1);
  assert.ok(reviewApprovalIssues(r, defaultReviewApproval(r)).some(i => /Lieferschein/.test(i)));
});

test("the live Amazon logistics proposal stays order-wide without weakening actual product binding", () => {
  const r = review(); r.products.push({ ...r.products[0], id: "product-2" });
  r.sources = [{ ...r.sources[0], text: "CHECK INFO\n**Do not split!!**" },
    { ...r.sources[1], label: "Eingang: Angebot", text: "Anbei findest du den Lieferschein mit der Lieferadresse, bitte mitsenden." }];
  const value = "Do not split the order; ship both signs together in one shipment. Please include the delivery note with the parcel.";
  const proposal = { id: "logistics", kind: "addition" as const, productId: r.products[0].id, field: "Additional Information", value,
    reason: "Versandhinweise", evidence: r.sources.map(s => ({ sourceId: s.id, quote: s.text })) };
  r.analysis = validateReviewAnalysis({ ...r.analysis, changes: [proposal] }, r.sources, r.products);
  const shipping = r.analysis.changes.find(c => c.id === "logistics")!;
  assert.equal(shipping.productId, null);
  assert.equal(shipping.questionOnly, undefined);
  assert.equal(shipping.value, value);
  assert.ok(!r.analysis.changes.some(c => /Produktzuordnung|Sonderhinweis/.test(c.reason)));
  assert.equal(r.analysis.changes.filter(c => c.id === "check-delivery-note").length, 1);
  assert.match(defaultReviewApproval(r).description, /Do not split the order/);
  for (const unsafe of [value + " Use red letters.", "Do not split the order for the first sign.", "Ship both signs together in one shipment. Change the delivery address."]) {
    const analysis = validateReviewAnalysis({ ...r.analysis, changes: [{ ...proposal, productId: r.products[0].id, value: unsafe }] }, r.sources, r.products);
    assert.equal(analysis.changes[0].questionOnly, true, unsafe);
  }
  const withoutShippingProof = validateReviewAnalysis({ ...r.analysis, changes: [{ ...proposal, productId: r.products[0].id,
    evidence: [{ sourceId: r.sources[1].id, quote: r.sources[1].text }] }] }, r.sources, r.products);
  assert.equal(withoutShippingProof.changes[0].questionOnly, true, "The model cannot invent a joint shipment");
});

test("a downgraded question cannot silently consume an existing card instruction", () => {
  const r = review();
  r.sources = [{ ...r.sources[0], text: "CHECK INFO\nDo not split!!" }];
  const analysis = validateReviewAnalysis({ summary: "Offen", threads: [], changes: [{ id: "mixed", kind: "conflict", questionOnly: true, productId: null,
    field: "Additional Information", value: "", reason: "Belege vermischt", evidence: [{ sourceId: "card", quote: r.sources[0].text }] }] }, r.sources, r.products);
  assert.ok(analysis.changes.some(c => !c.questionOnly && c.value === "Do not split!!" && c.kind === "conflict"));
});

test("delivery-note fallback excludes unrelated, outgoing, quoted, conditional and canceled instructions", () => {
  for (const [label, text, relevance] of [
    ["Eingang: Andere Bestellung", "Lieferschein bitte mitsenden.", "unrelated"],
    ["Ausgang: Angebot", "Lieferschein bitte mitsenden.", "related"],
    ["Eingang: Angebot", "Vielen Dank.\n\nVon: Jemand\nLieferschein bitte mitsenden.", "related"],
    ["Eingang: Angebot", "Lieferschein bitte nicht mitsenden.", "related"],
    ["Eingang: Angebot", "Falls nötig, den Lieferschein bitte mitsenden.", "related"],
    ["Eingang: Angebot", "Könnt ihr bitte den Lieferschein mitsenden?", "related"],
  ] as const) {
    const r = review();
    const sources = [{ ...r.sources[1], label, text }];
    const result = validateReviewAnalysis({ ...r.analysis, threads: [{ ...r.analysis.threads[0], relevance }], changes: [] }, sources, r.products);
    assert.deepEqual(result.changes, [], text);
  }
  const r = review();
  const sources = [
    { ...r.sources[1], label: "Eingang: Angebot", text: "Lieferschein bitte mitsenden.", at: "2026-11-01" },
    { ...r.sources[1], id: "mail:new", label: "Eingang: Angebot", text: "Lieferschein bitte nicht mitsenden.", at: "2026-11-02" },
  ];
  assert.deepEqual(validateReviewAnalysis({ ...r.analysis, changes: [] }, sources, r.products).changes, []);
});

test("accepted offer reference preserves delivery-note evidence without matching old orders or quoted body references", async () => {
  const old = process.env.OPS_OPENAI_API_KEY; process.env.OPS_OPENAI_API_KEY = "fixture";
  try {
    for (const [label, relevance, expected] of [
      ["Eingang: AW: Angebot A/N 16164", "unrelated", "related"],
      ["Eingang: AW: Angebot A/N 161640", "unrelated", "unrelated"],
      ["Eingang: AW: Angebot A/N 12345", "unrelated", "unrelated"],
      ["Eingang: AW: Angebot", "unrelated", "unrelated"],
      ["Eingang: A/N 16164 / A/N 12345", "unrelated", "uncertain"],
      ["Eingang: A/N 16164 #NEONT4662", "unrelated", "uncertain"],
      ["Eingang: A/N 16164", "uncertain", "related"],
    ] as const) {
      const r = review();
      const source = { ...r.sources[1], label, text: "Lieferschein bitte mitsenden.\n\nVon: Andere Person\nA/N 16164" };
      const result = await analyzeProductionReview({ products: r.products, sources: [source], orderReference: "#NEONT4857", offerReference: "A/N 16164", requestId: r.requestId }, async (_url, init) => {
        assert.equal(JSON.parse(JSON.parse(String(init?.body)).input).offerReference, "A/N 16164");
        return Response.json({ status: "completed", output: [{ content: [{ type: "output_text", text: JSON.stringify({ threads: { t1: { relevance, reason: "Keine technischen Änderungen" } }, changes: [] }) }] }] });
      });
      assert.equal(result.threads[0].relevance, expected, label);
      assert.equal(result.changes.some(c => c.id === "mail-delivery-note"), expected === "related", label);
    }
  } finally { if (old === undefined) delete process.env.OPS_OPENAI_API_KEY; else process.env.OPS_OPENAI_API_KEY = old; }
});

test("mixed-order citations become an open question while the explicit current delivery instruction survives", async () => {
  const old = process.env.OPS_OPENAI_API_KEY; process.env.OPS_OPENAI_API_KEY = "fixture";
  try {
    const r = review();
    const sources = [
      { ...r.sources[1], label: "Eingang: A/N 16164", text: "Anbei der Lieferschein mit der Lieferadresse, bitte mitsenden." },
      { ...r.sources[1], id: "mail:foreign", threadId: "foreign", label: "Eingang: A/N 11111", text: "Lieferschein bitte mitsenden." },
    ];
    const run = (value: string, current: boolean) => analyzeProductionReview({ products: r.products, sources, orderReference: "#NEONT4857", offerReference: current ? "A/N 16164" : null, requestId: r.requestId }, async (_url, init) => {
      const foreign = JSON.parse(JSON.parse(String(init?.body)).input).snippets.find((s: {text: string}) => s.text === sources[1].text);
      return Response.json({ status: "completed", output: [{ content: [{ type: "output_text", text: JSON.stringify({ threads: { t1: { relevance: "unrelated", reason: "Historisch" }, t2: { relevance: "unrelated", reason: "Andere Bestellung" } }, changes: [{ kind: "addition", productId: null, field: "Additional Information", value, reason: "Mitsenden", questionOnly: false, evidence: [foreign.id, ...(current ? [JSON.parse(JSON.parse(String(init?.body)).input).snippets.find((s: {text: string}) => s.text.startsWith('Anbei der Lieferschein')).id] : [])] }] }) }] }] });
    });
    const result = await run("Send delivery note with shipment.", true);
    assert.equal(result.changes.filter(c => c.kind === "addition").length, 1);
    assert.ok(result.changes.every(c => c.evidence.every(e => e.sourceId === sources[0].id)));
    assert.ok(result.changes.some(c => c.questionOnly));
    await assert.rejects(run("Send delivery note with shipment.", false), /nicht zugeordneten/);
    const unsafe = await run("Send delivery note with shipment and change the address.", true);
    assert.ok(unsafe.changes.some(c => c.questionOnly && /vermischt/.test(c.reason)));
    assert.ok(unsafe.changes.every(c => !/change the address/.test(c.value)));
  } finally { if (old === undefined) delete process.env.OPS_OPENAI_API_KEY; else process.env.OPS_OPENAI_API_KEY = old; }
});

test("order membership is independent of technical changes and uses exact subject references", async () => {
  const old = process.env.OPS_OPENAI_API_KEY; process.env.OPS_OPENAI_API_KEY = "fixture";
  try {
    for (const [label, extraLabel, modelRelevance, expected] of [
      ["Ausgang: Rechnung #NEONT4849 – NEONTRIP", "", "unrelated", "related"],
      ["Ausgang: Auftragsbestätigung und Rechnung #neont4849", "", "unrelated", "related"],
      ["Ausgang: Rechnung #NEONT48490", "", "unrelated", "unrelated"],
      ["Ausgang: Rechnung #NEONT4839", "", "unrelated", "unrelated"],
      ["Ausgang: Rechnung", "", "unrelated", "unrelated"],
      ["Ausgang: Rechnung #NEONT4849 / #NEONT4839", "", "unrelated", "uncertain"],
      ["Ausgang: Rechnung #NEONT4849", "Eingang: Rechnung #NEONT4839", "unrelated", "uncertain"],
      ["Ausgang: Rechnung #NEONT4849", "", "uncertain", "related"],
    ]) {
      const r = review();
      const source = { ...r.sources[1], label, text: "Rechnungsversand. Zitierter Verlauf: #NEONT4849." };
      const sources = [source, ...(extraLabel ? [{ ...source, id: "mail:second", label: extraLabel }] : [])];
      const result = await analyzeProductionReview({ products: r.products, sources, orderReference: "#NEONT4849", requestId: r.requestId }, async () =>
        Response.json({ status: "completed", output: [{ content: [{ type: "output_text", text: JSON.stringify({ threads: { t1: { relevance: modelRelevance, reason: "Keine technischen Änderungen." } }, changes: [] }) }] }] }));
      assert.equal(result.threads[0].relevance, expected, label + extraLabel);
      assert.deepEqual(result.changes, [], "order membership must not invent technical changes");
    }
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

test("old width alone and an already ordered white-backboard note do not create false questions", () => {
  for (const supplied of [false, true]) {
    const r = review(); r.products[0].fields = [{ label: "Size", value: "125x43cm" }, { label: "Backboard", value: "Rechteckig Weiß" }];
    r.sources = [{ ...r.sources[0], text: "UPDATE:\nUpdate white backboard\nSize: 125cm\nBackboard: Loose Letters" }];
    const changes = supplied ? [
      { id: "size", kind: "conflict" as const, productId: "product-1", field: "Size", value: "125cm", reason: "Alte Größe", evidence: [{ sourceId: "card", quote: "Size: 125cm" }] },
      { id: "white", kind: "conflict" as const, productId: null, field: "Additional Information", value: "Update white backboard", reason: "Hinweis prüfen", evidence: [{ sourceId: "card", quote: "Update white backboard" }] },
    ] : [];
    const result = validateReviewAnalysis({ summary: "Geprüft", threads: [], changes }, r.sources, r.products);
    assert.equal(result.changes.filter(c => c.kind !== "addition").length, 1);
    assert.equal(result.changes.find(c => c.kind === "conflict")?.field, "Backboard");
    assert.ok(result.changes.some(c => c.kind === "addition" && c.value === "Use a white backboard."));
    r.analysis = result;
    assert.match(defaultReviewApproval(r).description, /CHECK INFO\nUse a white backboard/);
    assert.match(defaultReviewApproval(r).description, /Size: 125x43cm/);
  }
  for (const size of ["124cm", "43cm", "125 x 45cm", "125cm maximum"]) {
    const r = review(); r.products[0].fields = [{ label: "Size", value: "125x43cm" }];
    r.sources = [{ ...r.sources[0], text: `Size: ${size}` }];
    assert.ok(validateReviewAnalysis({ summary: "Geprüft", threads: [], changes: [] }, r.sources, r.products).changes.some(c => c.field === "Size"), size);
  }
  for (const note of ["Update black backboard", "Do not use white backboard", "Update white backboard, cable left"]) {
    const r = review(); r.products[0].fields = [{ label: "Backboard", value: "Rechteckig Weiß" }];
    r.sources = [{ ...r.sources[0], text: "CHECK INFO\n" + note }];
    assert.ok(validateReviewAnalysis({ summary: "Geprüft", threads: [], changes: [] }, r.sources, r.products).changes.some(c => c.kind === "conflict"), note);
  }
  const mail = review(); mail.products[0].fields = [{ label: "Size", value: "125x43cm" }];
  mail.sources[0].text = "No technical values."; mail.sources[1].text = "Size: 125cm";
  const result = validateReviewAnalysis({ ...mail.analysis, changes: [{ id: "new-width", kind: "conflict", productId: "product-1", field: "Size", value: "125cm", reason: "Neue Mailangabe", evidence: [{ sourceId: "mail:old", quote: "Size: 125cm" }] }] }, mail.sources, mail.products);
  assert.ok(result.changes.some(c => c.id === "new-width"), "A mail instruction is not an old-card placeholder");
});

test("one artwork confirmation documents all mapping questions without accepting guessed text or releasing", () => {
  const r = review(); r.products.push({ ...r.products[0], id: "product-2", imageId: "image2", imageTitle: "Second bought image" });
  r.analysis.changes = [
    { id: "mapping", kind: "conflict", questionOnly: true, productId: null, field: "Additional Information", value: "", reason: 'Zuordnung der Texte zu den beiden Produkten klären: "A" und "B".', evidence: [{ sourceId: "mail:old", quote: r.sources[1].text }] },
    { id: "mapping-2", kind: "conflict", questionOnly: true, productId: null, field: "Additional Information", value: "", reason: "Produktzuordnung prüfen: ungeprüfter Text.", evidence: [{ sourceId: "mail:old", quote: r.sources[1].text }] },
    { id: "delivery-note", kind: "conflict", questionOnly: true, productId: null, field: "Additional Information", value: "", reason: "Lieferschein und Lieferadresse prüfen", evidence: [{ sourceId: "mail:old", quote: r.sources[1].text }] },
  ];
  const before = defaultReviewApproval(r), after = confirmPurchasedDesigns(r, before);
  assert.equal(designMappingQuestions(r).length, 2);
  assert.equal(after.confirmed, false);
  assert.deepEqual(before.decisions, {});
  for (const id of ["mapping", "mapping-2"]) {
    assert.equal(after.decisions[id].action, "reject");
    assert.match(after.decisions[id].note, /Produkt 1: Final design/);
    assert.match(after.decisions[id].note, /Produkt 2: Second bought image/);
  }
  assert.equal(after.decisions["delivery-note"], undefined);
  assert.equal(after.title, before.title); assert.equal(after.description, before.description);
  assert.ok(reviewApprovalIssues(r, { ...after, confirmed: true }).some(i => /Lieferschein/.test(i)));
  r.analysis.changes[0].requiresThreadId = "old-offer";
  assert.equal(designMappingQuestions(r).length, 1, "Mail linkage cannot be bypassed by artwork confirmation");
  delete r.analysis.changes[0].requiresThreadId;
  r.analysis.changes[0].reason = 'Welcher der beiden gelieferten Texte soll auf p1 (Neonschild) und welcher auf p2 (Design 2) platziert werden: "A" oder "B"?';
  assert.equal(designMappingQuestions(r).length, 2, "The actual fresh Amazon paraphrase must offer the same explicit confirmation");
  r.analysis.changes[0].reason = 'Bitte Zuordnung der texts bestätigen: "amazon rme contractor point" und "amazon rme red-tag area" – welches gehört zu p1 (180 x 46cm) und welches zu p2 (180 x 42cm)?';
  assert.equal(designMappingQuestions(r).length, 2, "The live mixed-language question still only confirms the purchased artwork");
  for (const technical of ["Produktzuordnung prüfen: Kabelposition links für das Logo.", "Welcher Text steht auf dem Lieferschein für Produkt 1?", "Produktzuordnung prüfen: Blue.", "Zuordnung der texts für p1 auf delivery note prüfen.", "Zuordnung der texts für p1 und cable position prüfen."]) {
    r.analysis.changes[0].reason = technical;
    assert.equal(designMappingQuestions(r).length, 1, technical);
  }
});

test("image batch decisions preserve documents, vectors, protected files and individual choices", () => {
  const r = review();
  const image = { ...r.attachments[0], name: "image.png", mimeType: "image/png", removable: true };
  r.attachments = [{ ...image, id: "one" }, { ...image, id: "two" },
    { ...image, id: "chosen" }, { ...image, id: "protected", removable: false },
    { ...image, id: "vector", name: "Logo.svg", mimeType: "image/svg+xml", decision: "keep" },
    { ...image, id: "document", name: "Lieferschein.pdf", mimeType: "application/pdf" },
    { ...image, id: "unknown", name: "Unknown.jpg", mimeType: "application/octet-stream" }];
  const before = defaultReviewApproval(r); before.attachments.chosen = "keep";
  assert.deepEqual(openImageVariants(r, before).map(a => a.id), ["one", "two"]);
  const labels = r.attachments.filter(a => a.name === "image.png").map(a => reviewAttachmentLabel(r, a));
  assert.equal(new Set(labels).size, 4);
  const issues = reviewApprovalIssues(r, { ...before, confirmed: true });
  assert.equal(issues.filter(i => /Datei prüfen: image.png/.test(i)).length, 3);
  assert.equal(reviewOpenStepCount(r, before, issues), issues.length - 1);
  for (const action of ["keep", "remove"] as const) {
    const after = decideImageVariants(r, before, action);
    assert.deepEqual(after.attachments, { vector: "keep", chosen: "keep", one: action, two: action });
    assert.equal(after.confirmed, false);
    assert.equal(after.description, before.description);
    assert.ok(reviewApprovalIssues(r, { ...after, confirmed: true }).some(i => /Lieferschein.pdf/.test(i)));
  }
  assert.deepEqual(before.attachments, { vector: "keep", chosen: "keep" });
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

const documentFixture = (overrides: Partial<ReviewDocument> = {}): ReviewDocument => ({
  id: 'trello:old', name: 'Drawing.pdf', origin: 'trello', attachmentId: 'old', href: 'https://trello.com/file',
  status: 'read', sha256: 'a'.repeat(64), pages: 2, role: 'drawing', recommendation: 'keep', summary: 'Passende Zeichnung.',
  findings: [], evidence: [{ page: 1, quote: '120 x 45 cm' }], recipient: [], addressMatch: false, ...overrides,
});

function sizeUpdateFixture() {
  const r = review(), d = documentFixture();
  guardDrawingDimensions(d, ['120 cm 45.09 cm Product-Typ: neon flex'], r.products);
  r.documents = [d];
  return { r, d };
}

test('size confirmation prepares one coherent update without approving production or changing bought data', async () => {
  const { r, d } = sizeUpdateFixture(), original = structuredClone(r);
  const base = approved(r);
  assert.doesNotMatch(base.title, /UPDATE NEW SIZE/);
  const a = confirmDrawingSizeUpdate(r, base, d.id);
  assert.equal(a.confirmed, false);
  assert.equal(a.attachments.old, 'keep');
  assert.deepEqual(r, original);
  assert.match(a.title, /^KEY KUNDE \| #NEONT-TEST \| UPDATE NEW SIZE \| CHECK INFO/);
  assert.match(a.description, /^UPDATE NEW SIZE\nProduct 1: 120 x 45 cm\nProduce at the sizes stated above/);
  assert.match(a.description, /Disregard conflicting dimensions in the attached drawing "Drawing.pdf"/);
  assert.match(a.description, /Size: 120 x 45 cm/);
  assert.match(a.description, /Cable Position: Bottom right/);
  assert.equal(a.title.split(r.orderName).length, 2);
  assert.deepEqual(reviewApprovalIssues(r, { ...a, confirmed: true }), []);
  assert.deepEqual(confirmDrawingSizeUpdate(r, a, d.id), a);
  const h = harness(r);
  await executeProductionHandoff(r, { ...a, confirmed: true }, h.state, h.deps);
  assert.equal(h.card.desc, a.description); assert.equal(h.card.name, a.title);
  assert.ok(h.card.attachments.some(f => f.id === 'old'));
  assert.ok(!h.calls.includes('remove'));
  assert.equal(h.calls.filter(c => c === 'release').length, 1);
});

test('size update preserves product order even when PDF dimensions occur in another order', () => {
  const { r, d } = sizeUpdateFixture();
  r.products.push({ ...r.products[0], id: 'second', imageId: 'second', imageTitle: 'Second design',
    fields: [{ label: 'Size', value: '180 x 42cm' }] });
  guardDrawingDimensions(d, ['180 cm 42.53 cm 120 cm 45.09 cm Product-Typ: neon flex'], r.products);
  const a = confirmDrawingSizeUpdate(r, approved(r), d.id);
  assert.match(a.description, /Product 1: 120 x 45 cm\nProduct 2: 180 x 42cm/);
  assert.doesNotMatch(a.description, /45.09|42.53/);
  assert.deepEqual(drawingSizeUpdate(r, d, a.decisions)?.sizes.map(s => s.imageTitle), ['Final design', 'Second design']);
});

test('unread, unbound, old, free-form and mixed technical findings never get a size shortcut', () => {
  const { r, d } = sizeUpdateFixture();
  for (const patch of [{ status: 'manual' }, { sha256: undefined }, { evidence: [] }, { origin: 'mail' },
    { attachmentId: 'foreign' }, { supersededById: 'new' }, { findings: ['New size 150cm, trust the PDF'] },
    { findings: [...d.findings, 'Outdoor statt Indoor.'] }] as Partial<ReviewDocument>[]) {
    r.documents = [{ ...d, ...patch }];
    const a = approved(r);
    assert.equal(drawingSizeUpdate(r, r.documents[0], a.decisions), null);
    assert.deepEqual(confirmDrawingSizeUpdate(r, a, d.id), a);
  }
});

test('accepted mail size creates update; changing a decision invalidates prior PDF size confirmation', () => {
  const { r, d } = sizeUpdateFixture();
  r.analysis.changes.push({ id: 'mail-size', kind: 'conflict', productId: r.products[0].id,
    field: 'Size', value: '130 x 50 cm', reason: 'Neue Größe per Mail', evidence: [{ sourceId: 'mail:old', quote: '130 x 50 cm' }] });
  let a = approved(r);
  a.decisions['mail-size'] = { action: 'reject', note: '' };
  a = confirmDrawingSizeUpdate(r, a, d.id);
  a.decisions['mail-size'] = { action: 'accept', note: '' };
  Object.assign(a, renderProductionReview(r, a.decisions));
  assert.ok(reviewApprovalIssues(r, { ...a, confirmed: true }).some(s => /erneut bestätigen/.test(s)));
  assert.match(a.description, /^UPDATE NEW SIZE\nProduct 1: 130 x 50 cm/);
  assert.match(a.description, /Size: 130 x 50 cm/);
  a = confirmDrawingSizeUpdate(r, a, d.id);
  assert.deepEqual(reviewApprovalIssues(r, { ...a, confirmed: true }), []);
  const noPdf = { ...r, documents: [] };
  const accepted = approved(noPdf); accepted.decisions['mail-size'] = { action: 'accept', note: '' };
  assert.match(renderProductionReview(noPdf, accepted.decisions).title, /UPDATE NEW SIZE/);
  accepted.decisions['mail-size'].action = 'reject';
  assert.doesNotMatch(renderProductionReview(noPdf, accepted.decisions).title, /UPDATE NEW SIZE/);
});

test('server rejects mismatched update text, changed PDF and removing its reference; other questions stay open', () => {
  const { r, d } = sizeUpdateFixture();
  const a = { ...confirmDrawingSizeUpdate(r, approved(r), d.id), confirmed: true };
  for (const patch of [{ title: a.title.replace('UPDATE NEW SIZE | ', '') },
    { description: a.description.replace('Size: 120 x 45 cm', 'Size: 999 x 999 cm') },
    { description: a.description.replace('UPDATE NEW SIZE', 'CHECK INFO') }]) {
    assert.ok(reviewApprovalIssues(r, { ...a, ...patch }).some(s => /müssen übereinstimmen/.test(s)));
  }
  assert.ok(reviewApprovalIssues(r, { ...a, attachments: { old: 'remove' } }).some(s => /Zeichnung behalten/.test(s)));
  const before = d.sha256; d.sha256 = 'b'.repeat(64);
  assert.ok(reviewApprovalIssues(r, a).some(s => /erneut bestätigen/.test(s))); d.sha256 = before;
  r.analysis.changes.push({ id: 'mapping', kind: 'conflict', productId: null, field: 'Additional Information',
    value: '', questionOnly: true, reason: 'Zuordnung offen', evidence: [] });
  assert.ok(reviewApprovalIssues(r, a).some(s => /Zuordnung offen/.test(s)));
  r.analysis.threads[0].relevance = 'uncertain';
  assert.ok(reviewApprovalIssues(r, a).some(s => /Mailzuordnung/.test(s)));
});

test('drawing advice keeps exact purchased values and image identities while differences remain unresolved', () => {
  const r = review();
  r.products[0].fields = [{ label: 'Size', value: '180 x 46cm' }, { label: 'Use', value: 'Indoor' }];
  r.products.push({ ...r.products[0], id: 'product-2', imageId: 'image2', imageTitle: 'Second purchased design', fields: [{ label: 'Size', value: '180 x 42cm' }] });
  const d = documentFixture({ recommendation: 'manual', findings: ['PDF: 180 cm · 46.09 cm · 180 cm · 42.53 cm.'] });
  r.documents = [d];
  const before = structuredClone(r), approval = defaultReviewApproval(r), issues = reviewApprovalIssues(r, approval);
  const advice = drawingReviewRecommendation(r, d)!;
  assert.match(advice.title, /Bestellwerte beibehalten/);
  assert.deepEqual(advice.orderedProducts.map(p => [p.id, p.imageTitle, p.fields[0].value]), [
    ['product-1', 'Final design', '180 x 46cm'], ['product-2', 'Second purchased design', '180 x 42cm'],
  ]);
  assert.deepEqual(r, before);
  assert.deepEqual(reviewApprovalIssues(r, approval), issues);
  assert.equal(openDocumentSuggestions(r, approval).length, 0);
  assert.equal(approval.attachments.old, undefined);
  assert.equal(approval.confirmed, false);
  r.products = [{ ...r.products[0], fields: [{ label: 'Size', value: '125x43cm' }, { label: 'Backboard', value: 'Rechteckig Weiß' }, { label: 'Use', value: 'Indoor' }] }];
  d.findings = ['Loose Letters statt weißer Rückplatte.', 'Outdoor statt Indoor.'];
  assert.deepEqual(drawingReviewRecommendation(r, d)?.orderedProducts[0].fields.map(f => f.value), ['125x43cm', 'Rechteckig Weiß', 'Indoor']);
});

test('drawing advice does not treat incomplete, superseded, or unbound documents as a proven current conflict', () => {
  const r = review(), d = documentFixture({ recommendation: 'manual', findings: ['Abweichung'] });
  for (const patch of [{ status: 'manual' }, { sha256: undefined }, { evidence: [] }, { findings: [] },
    { supersededById: 'new' }, { attachmentId: 'foreign' }, { origin: 'mail' }, { role: 'other' }, { recommendation: 'remove' }] as Partial<ReviewDocument>[]) {
    assert.equal(drawingReviewRecommendation(r, { ...d, ...patch }), null);
  }
});

test('customer changes and uncertain mail must be clarified before drawing advice treats order values as final', () => {
  const r = review(), d = documentFixture({ recommendation: 'manual', findings: ['Kabelposition abweichend'] });
  r.analysis.changes[0].evidence = [{ sourceId: 'mail:old', quote: 'Bitte ändern' }];
  assert.match(drawingReviewRecommendation(r, d)!.title, /Kundenänderung klären/);
  r.analysis.changes = [];
  r.analysis.threads[0].relevance = 'uncertain';
  assert.match(drawingReviewRecommendation(r, d)!.nextStep, /Zuerst diese Entscheidung/);
});

test('PDF recommendations need a human click; unresolved, protected and previously selected files stay untouched', () => {
  const r = review();
  r.attachments[0].removable = true;
  r.attachments.push({ ...r.attachments[0], id: 'conflict', name: 'Current.pdf' }, { ...r.attachments[0], id: 'protected', removable: false });
  r.documents = [documentFixture({ recommendation: 'remove' }), documentFixture({ id: 'trello:conflict', attachmentId: 'conflict', recommendation: 'manual', findings: ['Outdoor statt Indoor'] }), documentFixture({ id: 'trello:protected', attachmentId: 'protected', recommendation: 'remove' })];
  const a = defaultReviewApproval(r);
  assert.equal(a.attachments.old, undefined);
  assert.equal(openDocumentSuggestions(r, a).length, 1);
  const confirmed = confirmDocumentSuggestions(r, { ...a, confirmed: true });
  assert.equal(confirmed.attachments.old, 'remove');
  assert.equal(confirmed.attachments.conflict, undefined);
  assert.equal(confirmed.attachments.protected, undefined);
  assert.equal(confirmed.confirmed, false);
  assert.equal(confirmDocumentSuggestions(r, { ...a, attachments: { old: 'keep' } }).attachments.old, 'keep');
  assert.deepEqual(r.products, review().products);
});

test('document findings validate exact page evidence; technical differences never become batch removals', () => {
  const value = { role: 'drawing', summary: 'Andere Ausführung', recommendation: 'remove', findings: ['Outdoor statt Indoor'], recipient: [], evidence: [{ page: 2, quote: 'Outdoor' }] };
  assert.equal(validateDocumentFindings(documentFixture(), ['Zeichnung', 'Use: Outdoor'], value, {}).recommendation, 'manual');
  assert.throws(() => validateDocumentFindings(documentFixture(), ['Outdoor', 'Other'], value, {}), /beleg/i);
  assert.throws(() => validateDocumentFindings(documentFixture(), ['Zeichnung', 'Outdoor'], { ...value, evidence: [{ page: 2, quote: 'Indoor' }] }, {}), /beleg/i);
  assert.throws(() => validateDocumentFindings(documentFixture(), ['Outdoor'], { ...value, role: 'approved' }, {}), /Ungültig/);
});

test('delivery note confirmation requires a unique complete recipient block and no unresolved mail attachment', () => {
  const address = { name: 'Frau Beispiel', company: 'Firma GmbH', note: 'Lager 2', street: 'Teststraße 10', zip: '12345', city: 'Teststadt' };
  const recipient = ['Firma GmbH', 'Lager 2', 'Frau Beispiel', 'Teststraße 10', '12345 Teststadt'];
  const pages = ['Absender Andere Firma ' + recipient.join('\n') + '\nLieferschein'];
  assert.equal(deliveryAddressMatches(recipient, pages, address), true);
  assert.equal(deliveryAddressMatches(recipient, pages, { ...address, street: 'Teststraße 11' }), false);
  assert.equal(deliveryAddressMatches(recipient, ['Firma GmbH Footer Lager 2 Footer Frau Beispiel Teststraße 10 12345 Teststadt'], address), false);
  assert.equal(deliveryAddressMatches(recipient, pages, { ...address, zip: '' }), false);
  const r = review();
  r.analysis.changes.push({ id: 'check-delivery-note', kind: 'conflict', questionOnly: true, field: 'Additional Information', value: '', productId: null, reason: 'Lieferschein prüfen', evidence: [] });
  r.documents = [documentFixture({ origin: 'mail', role: 'delivery_note', addressMatch: true, recipient })];
  const a = defaultReviewApproval(r);
  assert.equal(a.decisions['check-delivery-note'], undefined);
  const checked = confirmDeliveryNote(r, a);
  assert.match(checked.decisions['check-delivery-note'].note, /Beilage zum Versand separat/);
  assert.equal(checked.confirmed, false);
  r.documents.push(documentFixture({ id: 'other', origin: 'mail', status: 'manual' }));
  assert.equal(reviewedDeliveryNote(r), null);
  assert.deepEqual(confirmDeliveryNote(r, a), a);
  r.documents = [documentFixture({ origin: 'mail', role: 'delivery_note', addressMatch: true, findings: ['Menge weicht ab'] })];
  assert.equal(reviewedDeliveryNote(r), null);
});

test('Graph PDF reader binds the existing mailbox/message, excludes inline signatures and rejects foreign pagination', async () => {
  const old = process.env.MICROSOFT_GRAPH_MAILBOX;
  process.env.MICROSOFT_GRAPH_MAILBOX = 'support@neontrip.de';
  const mail = { id: 'immutable+id/==', threadId: 'related', subject: 'Lieferschein', body: '', at: '2026-11-16', direction: 'inbound' as const, href: null };
  const calls: string[] = [];
  const fixtureFetch: typeof fetch = async (url, init) => {
    calls.push(String(url)); assert.equal(init?.method || 'GET', 'GET'); assert.equal(init?.redirect, 'error');
    assert.equal(new Headers(init?.headers).get('Prefer'), 'IdType="ImmutableId"');
    if (String(url).endsWith('/$value')) return new Response('%PDF-test');
    return Response.json({ value: [
      { id: 'signature', name: 'logo.pdf', contentType: 'application/pdf', size: 10, isInline: true, '@odata.type': '#microsoft.graph.fileAttachment' },
      { id: 'pdf/id', name: 'Lieferschein.pdf', contentType: 'application/pdf', size: 9, isInline: false, '@odata.type': '#microsoft.graph.fileAttachment' },
      { id: 'logo', name: 'logo.png', contentType: 'image/png', size: 10, isInline: false, '@odata.type': '#microsoft.graph.fileAttachment' },
    ] });
  };
  try {
    const result = await readSupplierSaleMailPdfs(mail, { token: async () => 'test', fetch: fixtureFetch });
    assert.equal(result.length, 1); assert.equal(calls.length, 2);
    assert.match(calls[1], /messages\/immutable%2Bid%2F%3D%3D\/attachments\/pdf%2Fid\/\$value$/);
    await assert.rejects(readSupplierSaleMailPdfs(mail, { token: async () => 'test', fetch: async () => Response.json({ value: [], '@odata.nextLink': 'https://other.example/attachments' }) }), /vollständig/);
    process.env.MICROSOFT_GRAPH_MAILBOX = 'other@example.com';
    await assert.rejects(readSupplierSaleMailPdfs(mail, { token: async () => { throw new Error('must not request token'); } }), /Dokumentquelle/);
  } finally { if (old === undefined) delete process.env.MICROSOFT_GRAPH_MAILBOX; else process.env.MICROSOFT_GRAPH_MAILBOX = old; }
});

test('bounded review renderer reads every page of oversized vector artwork without changing default label geometry', async () => {
  const pdf = await PDFDocument.create(); pdf.addPage([11666, 6737]); pdf.addPage([595, 842]);
  const bytes = await pdf.save();
  const images = await renderPdfPagesToPng(bytes, 2, 6, 1600);
  assert.equal(images.length, 2);
  for (const image of images) { assert.ok(image.readUInt32BE(16) <= 1600 && image.readUInt32BE(20) <= 1600); }
  await assert.rejects(renderPdfPagesToPng(bytes, 2, 1, 1600), /Seitenzahl/);
  const single = await PDFDocument.create(); single.addPage([100, 200]);
  const original = await renderPdfPagesToPng(await single.save(), 2, 1);
  assert.equal(original[0].readUInt32BE(16), 200); assert.equal(original[0].readUInt32BE(20), 400);
});


test('model cannot discard the latest/sole technical drawing or infer replacement across multiple products', () => {
  const old = documentFixture({ id: 'old', at: '2026-11-09T08:00:00Z', recommendation: 'remove' });
  const current = documentFixture({ id: 'current', at: '2026-11-11T08:00:00Z', recommendation: 'remove' });
  guardDrawingRemoval([old, current], 1);
  assert.equal(old.recommendation, 'remove'); assert.equal(current.recommendation, 'manual');
  assert.ok(current.findings.length);
  const multi = { ...old, recommendation: 'remove' as const };
  guardDrawingRemoval([multi, current], 2); assert.equal(multi.recommendation, 'manual');
});


test('mail-document freshness rejects changed/missing/new files before any handoff and preserves manual fallback', () => {
  const bytes = Buffer.from('actual PDF bytes');
  const previous = [documentFixture({ origin: 'mail', attachmentId: 'read', sha256: createHash('sha256').update(bytes).digest('hex') }), documentFixture({ origin: 'mail', attachmentId: 'manual', status: 'manual', sha256: undefined })];
  const current = [{ attachment: { id: 'read' }, bytes }, { attachment: { id: 'manual' }, bytes: null }];
  assert.equal(mailDocumentSourcesMatch(previous, current), true);
  assert.equal(mailDocumentSourcesMatch(previous, [{ ...current[0], bytes: Buffer.from('changed') }, current[1]]), false);
  assert.equal(mailDocumentSourcesMatch(previous, current.slice(0, 1)), false);
  assert.equal(mailDocumentSourcesMatch(previous, [...current, { attachment: { id: 'new' }, bytes }]), false);
  assert.equal(mailDocumentSourcesMatch(previous, [{ ...current[0], bytes: null }, current[1]]), false);
});


test('precise PDF dimensions cannot be rounded away by a model match verdict', () => {
  const d = documentFixture({ recommendation: 'keep', summary: 'Alles stimmt überein' });
  const products = [ { ...review().products[0], fields: [{ label: 'Size', value: '180 x 46cm' }] }, { ...review().products[0], id: 'p2', fields: [{ label: 'Size', value: '180 x 42cm' }] } ];
  guardDrawingDimensions(d, ['180.00 cm 46.09 cm 180.00 cm 42.53 cm Product-Typ: neon flex Depth: 2cm'], products);
  assert.equal(d.recommendation, 'manual'); assert.match(d.findings[0], /46.09 cm/); assert.match(d.findings[0], /42.53 cm/);
  assert.doesNotMatch(d.summary, /stimmt/);
  const matching = documentFixture(); guardDrawingDimensions(matching, ['120.00 cm 45.00 cm Product-Typ: neon flex'], review().products);
  assert.equal(matching.recommendation, 'keep');
  const old = documentFixture({ supersededById: 'new', recommendation: 'remove' }); guardDrawingDimensions(old, ['120cm 40cm Product-Typ: neon flex'], review().products);
  assert.equal(old.recommendation, 'remove');
});


test('missing drawing labels and positive matches do not duplicate explicit order choices', () => {
  const doc = documentFixture({ findings: ['Farbangabe ist im PDF nicht dokumentiert.', 'Kabelposition ist nicht angegeben.', 'Maße stimmen, kein Konflikt.', 'PDF nennt Outdoor statt bestelltem Indoor.'] });
  omitRedundantDocumentQuestions(doc, [{ ...review().products[0], fields: [...review().products[0].fields, { label: 'Color', value: 'Blue' }] }]);
  assert.deepEqual(doc.findings, ['PDF nennt Outdoor statt bestelltem Indoor.']);
});

test('an explicitly titled initial enquiry remains a reference when the model calls it other', () => {
  const text = ['Angebotsanfrage: Schriftzug. Beispielbild / Gestaltungsidee.'];
  const d = validateDocumentFindings(documentFixture(), text, { role: 'other', summary: 'Frühere Anfrage.', recommendation: 'remove', findings: [], recipient: [], evidence: [{ page: 1, quote: 'Angebotsanfrage' }] }, {});
  assert.equal(d.role, 'reference'); assert.equal(d.recommendation, 'remove');
  const unknown = validateDocumentFindings(documentFixture(), ['Unbekannte Datei'], { role: 'other', summary: 'Unbekannt.', recommendation: 'remove', findings: [], recipient: [], evidence: [{ page: 1, quote: 'Unbekannte Datei' }] }, {});
  assert.equal(unknown.recommendation, 'manual');
});

test('confirmed backboard assembly complements the purchased template instead of replacing Included', () => {
  const r = review();
  r.products[0].fields.push({ label: 'Backboard', value: 'Rechteckig Weiß' }, { label: 'Included', value: 'Mounting template' });
  const text = 'Hallo Frau Trapp,\n\nMir gefällt der Schriftzug auf der vormontierten Platte außerordentlich gut. Es müsste auf türkis angepasst werden.';
  r.sources = [{ ...r.sources[1], label: 'Eingang: Angebot', text }];
  const proposal = { id: 'assembly', kind: 'conflict' as const, productId: r.products[0].id, field: 'Included', value: 'Backboard pre-assembled with letters',
    reason: 'Kundin bestätigt vormontierte Rückplatte; Included listet nur Mounting template.', evidence: [{ sourceId: r.sources[0].id, quote: 'Hallo Frau Trapp,' }] };
  r.analysis = validateReviewAnalysis({ ...r.analysis, changes: [structuredClone(proposal)] }, r.sources, r.products);
  assert.equal(r.analysis.changes[0].kind, 'addition');
  assert.equal(r.analysis.changes[0].field, 'Additional Information');
  assert.match(r.analysis.changes[0].evidence[0].quote, /gefällt.*vormontierten Platte/);
  assert.match(defaultReviewApproval(r).description, /Included: Mounting template/);
  assert.match(defaultReviewApproval(r).description, /Pre-assemble the letters on the ordered backboard/);
  const drawing = documentFixture({ findings: [
    'Keine Angabe in der Zeichnung, dass die Rückplatte vormontiert geliefert wird; die Kundin hat jedoch ausdrücklich eine vormontierte Rückplatte bestätigt/gewünscht.',
    'Datei nennt Loose Letters statt weißer Rückplatte.',
    'Datei enthält keine eindeutige Bestätigung des im Auftrag genannten Inklusiv-Zubehörs (z. B. vormontierte Rückplatte), nur Produktstichworte; Vorproduktionsfreigabe benötigt.',
  ] });
  omitRedundantDocumentQuestions(drawing, r.products, r.analysis);
  assert.deepEqual(drawing.findings, ['Datei nennt Loose Letters statt weißer Rückplatte.']);
  const noProof = documentFixture({ findings: ['Keine Angabe zur vormontierten Rückplatte.'] });
  omitRedundantDocumentQuestions(noProof, r.products); assert.equal(noProof.findings.length, 1);
  for (const body of ['Könnten Sie einen Kostenvoranschlag mit vormontierter Rückplatte senden?', 'Die vormontierte Platte gefällt mir nicht.', 'Mir gefällt der Schriftzug auf der vormontierten Platte gut. Bitte aber ohne Rückplatte liefern.', 'Bitte ohne Rückplatte.\n\nVon: Kunde\n' + text]) {
    const result = validateReviewAnalysis({ ...r.analysis, changes: [{ ...proposal, evidence: [{ sourceId: r.sources[0].id, quote: body }] }] }, [{ ...r.sources[0], text: body }], r.products);
    assert.equal(result.changes[0].kind, 'conflict', body);
  }
  const later = { ...r.sources[0], id: 'mail:later', at: '2026-11-15T10:00:00Z', text: 'Bitte ohne Rückplatte liefern.' };
  assert.equal(validateReviewAnalysis({ ...r.analysis, changes: [structuredClone(proposal)] }, [...r.sources, later], r.products).changes[0].kind, 'conflict');
  const noBoard = [{ ...r.products[0], fields: r.products[0].fields.filter(f => f.label !== 'Backboard') }];
  assert.equal(validateReviewAnalysis({ ...r.analysis, changes: [structuredClone(proposal)] }, r.sources, noBoard).changes[0].kind, 'conflict');
});

test('a superseded initial design reference is a proposal while real reference instructions stay manual', () => {
  const reference = documentFixture({ id: 'reference', role: 'reference', at: '2026-11-06T08:00:00Z', supersededById: 'current', recommendation: 'manual',
    findings: ['Frühere Angebotsanfrage mit Wunschgröße 125×28 cm — wird durch spätere Zeichnung ersetzt und ist damit überholt.'],
    evidence: [{ page: 1, quote: 'Angebotsanfrage: ein Beispielbild als Orientierung für die Gestaltung.' }] });
  const current = documentFixture({ id: 'current', at: '2026-11-11T08:00:00Z', recommendation: 'manual', findings: ['Outdoor statt Indoor. Loose Letters statt weißer Platte.'] });
  const initial = structuredClone(reference);
  guardDrawingRemoval([reference, current], 1);
  assert.equal(reference.recommendation, 'remove'); assert.deepEqual(reference.findings, []);
  assert.equal(current.recommendation, 'manual'); assert.equal(current.findings.length, 1);
  for (const patch of [{ findings: ['Montageinformation fehlt in der späteren Zeichnung.'] }, { findings: ['Frühere Angebotsanfrage ist nicht vollständig ersetzt.'] }, { supersededById: 'missing' }, { at: '2026-11-12T08:00:00Z' }, { evidence: [{ page: 1, quote: 'Eine Montageschablone mit Bohrpositionen.' }] }]) {
    const unsafe = { ...structuredClone(initial), ...patch }; guardDrawingRemoval([unsafe, current], 1);
    assert.equal(unsafe.recommendation, 'manual');
  }
  const multi = structuredClone(initial); guardDrawingRemoval([multi, current], 2); assert.equal(multi.recommendation, 'manual');
  const text = ['125.00 cm 41.43 cm Product-Typ:3D Backlit Material: Stainless steel backboard: Loose Letters Depth: 4 cm'];
  const misclassified = validateDocumentFindings(documentFixture({ id: 'old', at: initial.at, supersededById: 'current' }), text,
    { role: 'other', recommendation: 'remove', summary: 'Älteres Maßblatt, durch neuere Zeichnung ersetzt.', findings: [], recipient: [], evidence: [{ page: 1, quote: text[0] }] }, {});
  assert.equal(misclassified.role, 'drawing'); guardDrawingRemoval([misclassified, current], 1); assert.equal(misclassified.recommendation, 'remove');
  const latest = { ...misclassified, supersededById: undefined }; guardDrawingRemoval([latest], 1); assert.equal(latest.recommendation, 'manual');
});

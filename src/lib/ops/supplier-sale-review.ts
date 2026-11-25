/** Serializable review contract shared by the existing Sales-Vergabe API and UI. */
export const QUENTIN_REVIEW_BOARD = "62bae9b97705e7419ed64593";
export const PRODUCTION_LISTS = {
  standard: { id: "6347e0971a7efc0482e6c3fe", name: "Sign Approved" },
  express: { id: "6544ca38c328c64bbcabf4e8", name: "Super Urgent Orders" },
} as const;
export type ProductionPriority = keyof typeof PRODUCTION_LISTS;
export type ReviewSource = {
  id: string; kind: "order" | "card" | "mail"; label: string; text: string;
  at: string | null; href: string | null; threadId?: string;
};
export type ReviewField = { label: string; value: string };
export type ReviewProduct = {
  id: string; title: string; quantity: number; fields: ReviewField[];
  imageUrl: string; imageId: string; imageTitle: string; imageHash: string;
  orderTitle?: string;
};
export type ReviewChange = {
  id: string; kind: "addition" | "conflict" | "obsolete";
  productId: string | null; field: string; value: string; reason: string;
  questionOnly?: boolean;
  requiresThreadId?: string;
  evidence: Array<{ sourceId: string; quote: string }>;
};
export type ReviewAttachment = {
  id: string; name: string; url: string; mimeType: string;
  previewUrl: string | null; decision: "keep" | "remove" | "undecided";
  reason: string;
  removable?: boolean;
};
export type ReviewMail = {
  id: string; threadId: string; subject: string; body: string; at: string;
  direction: "inbound" | "outbound"; href: string | null;
  hasAttachments?: boolean;
};
/** Read-only document findings. Recommendations never preselect removal. */
export type ReviewDocument = {
  id: string; name: string; origin: "trello" | "mail"; href: string | null;
  attachmentId: string; mailId?: string; status: "read" | "manual";
  sha256?: string; at?: string; supersededById?: string; pages: number; summary: string;
  role: "drawing" | "reference" | "delivery_note" | "other";
  recommendation: "keep" | "remove" | "manual";
  findings: string[]; evidence: Array<{ page: number; quote: string }>;
  recipient: string[]; addressMatch: boolean;
};
export type ReviewAnalysis = {
  summary: string; changes: ReviewChange[];
  threads: Array<{ id: string; relevance: "related" | "unrelated" | "uncertain"; reason: string }>;
};
export type ProductionReview = {
  version: 1; id: string; saleId: string; preparedAt: string; sourceHash: string;
  orderHash: string; mailHash: string; cardHash: string;
  orderName: string; customerName: string; requestId: string | null;
  cardId: string; cardUrl: string; originalTitle: string; originalDescription: string;
  originalListId: string; originalCoverId: string | null; originalPos: number;
  products: ReviewProduct[]; accessories: string[]; sources: ReviewSource[];
  analysis: ReviewAnalysis; attachments: ReviewAttachment[];
  priority: ProductionPriority; mailCount: number; blockers: string[];
  documents?: ReviewDocument[];
};
export type ReviewApproval = {
  reviewId: string; title: string; description: string;
  decisions: Record<string, { action: "accept" | "reject"; note: string }>;
  attachments: Record<string, "keep" | "remove">;
  coverProductId: string; priority: ProductionPriority; priorityReason: string;
  operatorNote: string; confirmed: boolean;
};

export type ReviewRecoveryAction = "edit" | "load" | "prepare" | "status" | "retry";
export type ReviewProblem = { code: string; message: string; field?: string; action: ReviewRecoveryAction };
export type ReviewDraftInput = {
  approval: ReviewApproval; edited: boolean; assignmentNote: string; requestedDeliveryDate: string;
  manualTextNeedsReview: boolean;
};
export type ReviewDraft = ReviewDraftInput & {
  version: 1; revision: number; savedAt: string; savedBy: string | null;
  previousChoices: Array<{ label: string; value: string }>;
};

/** Draft storage accepts incomplete work. Only release requires complete decisions. */
export function reviewDraftInputIssues(value: unknown): string[] {
  const record = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));
  if (!record(value) || !record(value.approval)) return ["Der Prüfentwurf hat ein ungültiges Format. Deine lokale Auswahl bleibt erhalten."];
  const a = value.approval;
  if (typeof value.edited !== "boolean" || typeof value.manualTextNeedsReview !== "boolean"
    || typeof value.assignmentNote !== "string" || typeof value.requestedDeliveryDate !== "string"
    || !["reviewId", "title", "description", "coverProductId", "priority", "priorityReason", "operatorNote"].every(k => typeof a[k] === "string")
    || typeof a.confirmed !== "boolean" || !record(a.decisions) || !record(a.attachments)
    || Object.values(a.decisions).some(d => !record(d) || !["accept", "reject"].includes(String(d.action)) || typeof d.note !== "string")
    || Object.values(a.attachments).some(d => !["", "keep", "remove"].includes(String(d)))) return ["Der Prüfentwurf hat ein ungültiges Format. Bitte den aktuellen Stand laden."];
  if (JSON.stringify(value).length > 300_000 || Object.keys(a.decisions).length > 500 || Object.keys(a.attachments).length > 500) return ["Der Prüfentwurf ist zu umfangreich zum Speichern. Bitte eingefügte Volltexte kürzen; deine lokale Auswahl bleibt erhalten."];
  return [];
}

/** JSONB may reorder object keys; equality must follow the choices, never key order. */
export function reviewApprovalContent(a: ReviewApproval): ReviewApproval {
  return { reviewId: a.reviewId, title: a.title, description: a.description,
    decisions: Object.fromEntries(Object.keys(a.decisions).sort().map(id => [id, { action: a.decisions[id].action, note: a.decisions[id].note }])),
    attachments: Object.fromEntries(Object.keys(a.attachments).sort().map(id => [id, a.attachments[id]])),
    coverProductId: a.coverProductId, priority: a.priority, priorityReason: a.priorityReason, operatorNote: a.operatorNote, confirmed: false };
}

export function reviewDraftContent(draft: ReviewDraftInput): ReviewDraftInput {
  return { approval: reviewApprovalContent(draft.approval), edited: draft.edited,
    assignmentNote: draft.assignmentNote, requestedDeliveryDate: draft.requestedDeliveryDate,
    manualTextNeedsReview: draft.manualTextNeedsReview };
}

export function productionPriorityFromDeliveryTitles(titles: string[]): ProductionPriority {
  return titles.some(title => /express|eilauftrag|eilproduktion|eilversand|\brush\b/i.test(title)
    && !/\b(kein|ohne|no)\b/i.test(title)) ? "express" : "standard";
}

/** Human confirmation of purchased artwork, never an inferred text-to-image mapping. */
export function designMappingQuestions(review: ProductionReview) {
  return review.products.length > 1 ? review.analysis.changes.filter(c => c.questionOnly && !c.requiresThreadId
    && /\b(text(?:e|en|s)?|logo(?:text(?:e|en|s)?)?|schriftzug)\b/i.test(c.reason)
    && /\b(produkt\w*|products?|p\d+)\b/i.test(c.reason)
    && /zuordn|welch|platzier|\bwhich\b/i.test(c.reason)
    && !/lieferschein|lieferadresse|versand|montage|kabel|farbe|größe|delivery note|address|shipping|shipment|mounting|cable|colou?r|size/i.test(c.reason)) : [];
}

export function confirmPurchasedDesigns(review: ProductionReview, approval: ReviewApproval): ReviewApproval {
  const decisions = { ...approval.decisions };
  const designs = review.products.map((p, i) => `Produkt ${i + 1}: ${p.imageTitle} (${p.fields.find(f => f.label === "Size")?.value || p.title})`).join("; ");
  for (const question of designMappingQuestions(review)) decisions[question.id] = {
    action: "reject", note: `Gekaufte Designs visuell geprüft: ${designs}. Produktion nach diesen freigegebenen Designs; keine abweichende Textzuordnung aus der Mail-Aufzählung übernehmen.`.slice(0, 2000),
  };
  return { ...approval, decisions, confirmed: false };
}

/** Only unresolved raster images participate. PDFs, vectors and existing choices stay separate. */
export function openImageVariants(review: ProductionReview, approval: ReviewApproval) {
  return review.attachments.filter(a => !approval.attachments[a.id] && a.decision === "undecided" && a.removable === true
    && /\.(png|jpe?g|webp|gif|avif)$/i.test(a.name) && /^image\/(png|jpe?g|webp|gif|avif)$/i.test(a.mimeType));
}

export function decideImageVariants(review: ProductionReview, approval: ReviewApproval, action: "keep" | "remove"): ReviewApproval {
  return { ...approval, confirmed: false, attachments: { ...approval.attachments,
    ...Object.fromEntries(openImageVariants(review, approval).map(a => [a.id, action])),
  } };
}

export function reviewAttachmentLabel(review: ProductionReview, attachment: ReviewAttachment) {
  const sameName = review.attachments.filter(a => a.name === attachment.name);
  return sameName.length > 1 ? `${attachment.name} (${sameName.findIndex(a => a.id === attachment.id) + 1} von ${sameName.length})` : attachment.name;
}

export function openDocumentSuggestions(review: ProductionReview, approval: ReviewApproval) {
  return (review.documents || []).filter(d => d.origin === "trello" && d.status === "read" && d.recommendation !== "manual"
    && !approval.attachments[d.attachmentId] && review.attachments.some(a => a.id === d.attachmentId && (d.recommendation !== "remove" || a.removable === true)));
}

export function confirmDocumentSuggestions(review: ProductionReview, approval: ReviewApproval): ReviewApproval {
  return { ...approval, confirmed: false, attachments: { ...approval.attachments,
    ...Object.fromEntries(openDocumentSuggestions(review, approval).map(d => [d.attachmentId, d.recommendation as "keep" | "remove"])),
  } };
}

/** Explain validated AI findings using the accepted order, without resolving a file or changing production. */
export function drawingReviewRecommendation(review: ProductionReview, document: ReviewDocument) {
  if (document.origin !== "trello" || document.status !== "read" || document.role !== "drawing"
    || document.recommendation !== "manual" || !document.findings.length || !document.evidence.length
    || !document.sha256 || document.supersededById
    || !review.attachments.some(a => a.id === document.attachmentId)) return null;
  const designQuestions = designMappingQuestions(review);
  const customerChange = review.analysis.threads.some(t => t.relevance === "uncertain")
    || review.analysis.changes.some(c => c.kind !== "obsolete" && (c.kind === "conflict" || c.questionOnly)
      && c.id !== "check-delivery-note" && !designQuestions.some(q => q.id === c.id)
      && c.evidence.some(e => review.sources.some(s => s.id === e.sourceId && s.kind === "mail")));
  return {
    title: customerChange ? "Kundenänderung klären, dann Zeichnung korrigieren lassen" : "Bestellwerte beibehalten, Zeichnung korrigieren lassen",
    nextStep: customerChange
      ? "Die Korrespondenz enthält noch eine Änderung oder ungeklärte Zuordnung. Zuerst diese Entscheidung prüfen; anschließend die Zeichnung mit der bestätigten Produktionsvorschau abgleichen."
      : "Die Zeichnung anhand der Bestellwerte und der bestätigten Mailhinweise korrigieren lassen. Danach die korrigierte Datei prüfen und den Entwurf neu vorbereiten.",
    orderedProducts: review.products.map((p, index) => ({ id: p.id, label: `Produkt ${index + 1}`, imageTitle: p.imageTitle,
      fields: p.fields.filter(f => /^(Size|Backboard Size|Letter Size|Backboard|Use)$/i.test(f.label)).map(f => ({
        label: ({ Size: "Maße", "Backboard Size": "Rückplattenmaß", "Letter Size": "Buchstabenmaß", Backboard: "Rückplatte", Use: "Einsatz" } as Record<string, string>)[f.label] || f.label,
        value: f.value,
      })),
    })),
  };
}

export function reviewedDeliveryNote(review: ProductionReview) {
  if (review.documents?.some(d => d.origin === "mail" && d.status !== "read")) return null;
  const notes = (review.documents || []).filter(d => d.origin === "mail" && d.role === "delivery_note");
  return notes.length === 1 && notes[0].status === "read" && notes[0].addressMatch && !notes[0].findings.length ? notes[0] : null;
}

export function confirmDeliveryNote(review: ProductionReview, approval: ReviewApproval): ReviewApproval {
  const document = reviewedDeliveryNote(review);
  if (!document || !review.analysis.changes.some(c => c.id === "check-delivery-note" && c.questionOnly)) return approval;
  return { ...approval, confirmed: false, decisions: { ...approval.decisions, "check-delivery-note": {
    action: "reject", note: `Lieferschein ${document.name} (${document.pages} Seiten) geprüft; Empfänger und Lieferadresse stimmen mit der Bestellung überein. Beilage zum Versand separat bereitstellen. SHA256: ${document.sha256}`.slice(0, 2000),
  } } };
}

const sizeField = /^(Size|Backboard Size|Letter Size)$/i;
const sizeValue = /^\s*\d+(?:[.,]\d+)?(?:\s*(?:x|×)\s*\d+(?:[.,]\d+)?){0,2}\s*(?:mm|cm|m)\s*$/i;

/** Only order values and explicitly accepted, validated changes determine production sizes. */
function productionSizes(review: ProductionReview, decisions: ReviewApproval["decisions"]) {
  return review.products.flatMap((product, index) => {
    const fields = product.fields.filter(f => sizeField.test(f.label)).map(field => {
      const accepted = review.analysis.changes.filter(c => c.productId === product.id && c.field.toLowerCase() === field.label.toLowerCase()
        && c.kind !== "obsolete" && !c.questionOnly && decisions[c.id]?.action === "accept");
      return { label: field.label, value: accepted.at(-1)?.value || field.value };
    });
    return fields.map(field => ({ productId: product.id, productLabel: `Product ${index + 1}`, imageTitle: product.imageTitle, ...field }));
  });
}

/** Use the existing deterministic cm finding, never infer PDF-to-product order. */
export function drawingSizeUpdate(review: ProductionReview, document: ReviewDocument, decisions: ReviewApproval["decisions"]) {
  if (!drawingReviewRecommendation(review, document) || document.findings.length !== 1
    || !/^Maßangaben im PDF: (?:\d+(?:\.\d+)? cm · )*\d+(?:\.\d+)? cm\. Bestellt: .+\. Keine Rundung oder neue Produktzuordnung übernommen\.$/.test(document.findings[0])) return null;
  const sizes = productionSizes(review, decisions);
  if (!sizes.length || review.products.some(p => !sizes.some(s => s.productId === p.id)) || sizes.some(s => !sizeValue.test(s.value))) return null;
  const id = `drawing-size:${document.id}`;
  const note = JSON.stringify({ document: document.id, sha256: document.sha256, sizes: sizes.map(s => [s.productId, s.label, s.value]) });
  if (note.length > 2000) return null;
  return { id, note, sizes, confirmed: decisions[id]?.action === "accept" && decisions[id]?.note === note };
}

export function confirmDrawingSizeUpdate(review: ProductionReview, approval: ReviewApproval, documentId: string): ReviewApproval {
  const document = review.documents?.find(d => d.id === documentId);
  const update = document && drawingSizeUpdate(review, document, approval.decisions);
  if (!document || !update) return approval;
  const decisions = { ...approval.decisions, [update.id]: { action: "accept" as const, note: update.note } };
  return { ...approval, decisions, attachments: { ...approval.attachments, [document.attachmentId]: "keep" },
    ...renderProductionReview(review, decisions), confirmed: false };
}

function sizeUpdateBlock(review: ProductionReview, decisions: ReviewApproval["decisions"]) {
  const drawings = (review.documents || []).filter(d => drawingSizeUpdate(review, d, decisions)?.confirmed);
  const changed = review.analysis.changes.filter(c => c.kind === "conflict" && !c.questionOnly && c.productId
    && sizeField.test(c.field) && sizeValue.test(c.value) && decisions[c.id]?.action === "accept"
    && review.products.find(p => p.id === c.productId)?.fields.some(f => f.label.toLowerCase() === c.field.toLowerCase() && f.value !== c.value));
  const sizes = productionSizes(review, decisions).filter(s => drawings.length || changed.some(c => c.productId === s.productId && c.field.toLowerCase() === s.label.toLowerCase()));
  if (!sizes.length) return "";
  return ["UPDATE NEW SIZE", ...sizes.map(s => `${s.productLabel}: ${s.label === "Size" ? "" : s.label + ": "}${s.value}`),
    "Produce at the sizes stated above.",
    ...drawings.map(d => `Disregard conflicting dimensions in the attached drawing "${d.name.replace(/[\r\n"]/g, " ")}". Other specifications remain unchanged.`)].join("\n");
}

/** Group only issues that actually exist; a technical error is never subtracted away. */
export function reviewOpenStepCount(review: ProductionReview, approval: ReviewApproval, issues: string[]) {
  const groups = [
    openImageVariants(review, approval).map(a => `Datei prüfen: ${reviewAttachmentLabel(review, a)}`),
    designMappingQuestions(review).filter(c => !approval.decisions[c.id]).map(c => `Entscheidung fehlt: ${c.reason}`),
    openDocumentSuggestions(review, approval).map(d => `Datei prüfen: ${reviewAttachmentLabel(review, review.attachments.find(a => a.id === d.attachmentId)!)}`),
  ];
  return groups.reduce((count, group) => count - Math.max(0, new Set(group.filter(message => issues.includes(message))).size - 1), issues.length);
}

export function defaultReviewApproval(review: ProductionReview): ReviewApproval {
  const decisions: ReviewApproval["decisions"] = {};
  for (const change of review.analysis.changes) {
    if (change.kind === "addition" && !change.questionOnly) decisions[change.id] = { action: "accept", note: "" };
  }
  const base: ReviewApproval = {
    reviewId: review.id, title: "", description: "", decisions,
    attachments: Object.fromEntries(review.attachments.filter(a => a.decision !== "undecided").map(a => [a.id, a.decision as "keep" | "remove"])),
    coverProductId: review.products[0]?.id || "", priority: review.priority,
    priorityReason: "", operatorNote: "", confirmed: false,
  };
  return { ...base, ...renderProductionReview(review, base.decisions) };
}

/** Positive integer quantities from the accepted order; no model or design-count inference. */
function pieceCountWords(count: number): string {
  const small = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  if (count < 20) return small[count];
  if (count < 100) return ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"][Math.floor(count / 10)]
    + (count % 10 ? `-${small[count % 10]}` : "");
  for (const [scale, word] of [[1e15, "Quadrillion"], [1e12, "Trillion"], [1e9, "Billion"], [1e6, "Million"], [1000, "Thousand"], [100, "Hundred"]] as const) {
    if (count >= scale) return `${pieceCountWords(Math.floor(count / scale))} ${word}${count % scale ? ` ${pieceCountWords(count % scale)}` : ""}`;
  }
  return String(count);
}

export function renderProductionReview(review: ProductionReview, decisions: ReviewApproval["decisions"]) {
  const products = review.products.map(p => ({ ...p, fields: p.fields.map(f => ({ ...f })) }));
  const pieceCount = products.reduce((sum, p) => sum + p.quantity, 0);
  const pieces = Number.isSafeInteger(pieceCount) && pieceCount > 1 ? `${pieceCountWords(pieceCount)} Pieces` : "";
  const notes: string[] = pieces ? [`${pieces} Shipped Together`] : [];
  for (const change of review.analysis.changes) {
    // Obsolete refers to an old note, never permission to delete a purchased production field.
    if (change.kind === "obsolete") {
      if (decisions[change.id]?.action === "reject" && change.field === "Additional Information" && change.value) notes.push(change.value);
      continue;
    }
    if (decisions[change.id]?.action !== "accept" || change.questionOnly) continue;
    const product = products.find(p => p.id === change.productId);
    if (product && change.field !== "Additional Information") {
      product.fields = product.fields.filter(f => f.label.toLowerCase() !== change.field.toLowerCase());
      product.fields.push({ label: change.field, value: change.value });
    } else if (change.value) {
      notes.push(product ? `Product ${products.indexOf(product) + 1}: ${change.value}` : change.value);
    }
  }
  const summary = products.map(p => {
    const fields = p.fields.filter(f => /^(Size|Backboard Size|Letter Size|Light Color|Color|Backboard)$/i.test(f.label));
    return [p.quantity > 1 ? `${p.quantity}x` : "", p.title, ...fields.map(f => f.value)].filter(Boolean).join(" / ");
  }).join(" + ");
  const keyCustomer = /\bKEY KUNDE\b/i.test(review.originalTitle) ? "KEY KUNDE | " : "";
  const sizeUpdate = sizeUpdateBlock(review, decisions);
  const marker = notes.length ? "CHECK INFO | " : "";
  const title = `${keyCustomer}${review.orderName} | ${pieces ? `${pieceCount} PCS - ${pieces} | ` : ""}${sizeUpdate ? "UPDATE NEW SIZE | " : ""}${marker}${review.customerName} | ${summary}`;
  const blocks = products.map((p, i) => [
    products.length > 1 ? `Product ${i + 1}: ${p.title}` : p.title,
    ...p.fields.map(f => `${f.label}: ${f.value}`),
    `Quantity: ${p.quantity} Piece${p.quantity === 1 ? "" : "s"}`,
  ].join("\n"));
  const description = [
    sizeUpdate || null,
    notes.length ? `CHECK INFO\n${notes.join("\n")}` : null,
    ...blocks,
    review.accessories.length ? `Ordered accessories (quantities as ordered):\n${review.accessories.join("\n")}` : null,
    review.requestId ? `Request-ID: ${review.requestId}` : null,
  ].filter(Boolean).join("\n\n");
  return { title, description };
}

export function reviewApprovalProblems(review: ProductionReview, approval: ReviewApproval): ReviewProblem[] {
  const problems: ReviewProblem[] = review.blockers.map(message => ({ code: "source_blocked", message, action: "prepare" }));
  const add = (code: string, message: string, field?: string, action: ReviewRecoveryAction = "edit") => problems.push({ code, message, field, action });
  const record = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));
  if (!record(approval) || !(["reviewId", "title", "description", "coverProductId", "priority", "priorityReason", "operatorNote"] as const).every(k => typeof approval[k] === "string")
    || typeof approval.confirmed !== "boolean" || !record(approval.decisions) || !record(approval.attachments)) return [{ code: "approval_format", message: "Die Auswahl konnte nicht gelesen werden. Bitte den aktuellen Prüfstand laden.", action: "load" }];
  // A stale review must not masquerade as a length error or a missing decision.
  if (approval.reviewId !== review.id) return [{ code: "review_changed", message: "Der Prüfentwurf wurde inzwischen erneuert. Bitte den aktuellen Stand laden; bisherige Entscheidungen werden abgeglichen.", action: "load" }];
  const decisionIds = new Set([...review.analysis.changes.map(c => c.id),
    ...review.analysis.threads.filter(t => t.relevance === "uncertain" || review.analysis.changes.some(c => c.requiresThreadId === t.id)).map(t => `thread:${t.id}`)]);
  for (const d of review.documents || []) {
    const update = drawingSizeUpdate(review, d, approval.decisions);
    const id = `drawing-size:${d.id}`;
    if (update || approval.decisions[id]) decisionIds.add(id);
    if (approval.decisions[id] && (!update?.confirmed || approval.attachments[d.attachmentId] !== "keep")) add("drawing_changed", "Größen-Update erneut bestätigen und die referenzierte Zeichnung behalten.", `decisions.${id}`);
  }
  for (const [id, d] of Object.entries(approval.decisions)) {
    if (!decisionIds.has(id)) { add("decision_changed", "Eine gespeicherte Entscheidung gehört zu einem anderen Prüfstand. Bitte den aktuellen Stand laden.", `decisions.${id}`, "load"); continue; }
    if (!record(d) || !["accept", "reject"].includes(String(d.action)) || typeof d.note !== "string") { add("decision_format", "Diese Prüfentscheidung konnte nicht gelesen werden. Bitte erneut auswählen.", `decisions.${id}`); continue; }
    if (d.note.length > 2000) {
      const label = review.analysis.changes.find(c => c.id === id)?.reason || "Mailzuordnung";
      add("text_too_long", `Notiz zu „${label}“: ${d.note.length} von 2000 Zeichen. Bitte um ${d.note.length - 2000} Zeichen kürzen.`, `decisions.${id}.note`);
    }
  }
  for (const id of Object.keys(approval.attachments)) if (!review.attachments.some(a => a.id === id)) add("attachment_changed", "Eine ausgewählte Datei ist in diesem Prüfstand nicht mehr enthalten. Bitte den aktuellen Stand laden.", `attachments.${id}`, "load");
  for (const [field, label, max] of [["title", "Kartentitel", 1000], ["description", "Produktionsbeschreibung", 16000], ["priorityReason", "Notiz zur Produktionsliste", 2000], ["operatorNote", "Interne Prüfnote", 4000]] as const) {
    const value = approval[field];
    if ((field === "title" || field === "description") && !value.trim()) add("text_missing", `${label} fehlt. Bitte das Feld ergänzen.`, field);
    if (value.length > max) add("text_too_long", `${label}: ${value.length} von ${max} Zeichen. Bitte um ${value.length - max} Zeichen kürzen.`, field);
  }
  const updateBlock = sizeUpdateBlock(review, approval.decisions);
  if (updateBlock) {
    const expected = renderProductionReview(review, approval.decisions);
    if (approval.title.replace("CHECK INFO | ", "") !== expected.title.replace("CHECK INFO | ", "")
      || !approval.description.startsWith(updateBlock + "\n\n")
      || !approval.description.endsWith(expected.description.slice(updateBlock.length + 2))) add("size_text_mismatch", "Größen-Update, Titel und Produktionsmaße müssen übereinstimmen. Automatische Vorschau wiederherstellen.", "description");
  }
  if (!approval.confirmed) add("confirmation_missing", "Bitte die vollständige Vorschau bestätigen.", "confirmed");
  if (approval.title.split(review.orderName).length !== 2) add("order_reference", "Die Bestellreferenz muss genau einmal im Titel stehen.", "title");
  if (/KEY KUNDE/i.test(review.originalTitle) && !/^KEY KUNDE\s*\|/.test(approval.title)) add("key_customer", "KEY KUNDE muss am Titelanfang erhalten bleiben.", "title");
  if (review.requestId && !approval.description.includes(`Request-ID: ${review.requestId}`)) add("request_reference", "Die Request-ID muss erhalten bleiben.", "description");
  if (!review.products.some(p => p.id === approval.coverProductId)) add("cover_missing", "Bitte ein gekauftes Design als Cover wählen.", "coverProductId");
  if (!Object.hasOwn(PRODUCTION_LISTS, approval.priority)) add("priority_invalid", "Bitte eine gültige Produktionsliste wählen.", "priority");
  for (const change of review.analysis.changes) {
    const decision = approval.decisions[change.id];
    if (!decision || !["accept", "reject"].includes(decision.action)) add("decision_missing", `Entscheidung fehlt: ${change.reason}`, `decisions.${change.id}`);
    if (change.requiresThreadId && decision?.action === "accept" && approval.decisions[`thread:${change.requiresThreadId}`]?.action !== "accept") add("thread_missing", "Die Logo-Korrektur muss diesem Auftrag ausdrücklich zugeordnet werden.", `decisions.thread:${change.requiresThreadId}`);
  }
  for (const thread of review.analysis.threads.filter(t => t.relevance === "uncertain" && !review.analysis.changes.some(c => c.requiresThreadId === t.id))) {
    if (!approval.decisions[`thread:${thread.id}`]) add("thread_missing", `Mailzuordnung klären: ${thread.reason}`, `decisions.thread:${thread.id}`);
  }
  for (const attachment of review.attachments) {
    if (!["keep", "remove"].includes(approval.attachments[attachment.id])) add("attachment_missing", `Datei prüfen: ${reviewAttachmentLabel(review, attachment)}`, `attachments.${attachment.id}`);
    if (approval.attachments[attachment.id] === "remove" && attachment.removable === false) add("attachment_protected", `Diese Datei muss erhalten bleiben: ${reviewAttachmentLabel(review, attachment)}`, `attachments.${attachment.id}`);
  }
  return problems.filter((p, i) => problems.findIndex(other => other.message === p.message && other.field === p.field) === i);
}

export function reviewApprovalIssues(review: ProductionReview, approval: ReviewApproval): string[] {
  return [...new Set(reviewApprovalProblems(review, approval).map(p => p.message))];
}

export function renderReviewWithAssignment(review: ProductionReview, decisions: ReviewApproval["decisions"], assignmentNote: string) {
  const text = renderProductionReview(review, decisions);
  const note = assignmentNote.trim();
  if (note) {
    const blocks = text.description.split("\n\n");
    blocks.splice(blocks[0]?.startsWith("UPDATE NEW SIZE\n") ? 1 : 0, 0, `CHECK INFO\n${note}`);
    text.description = blocks.join("\n\n");
    if (!text.title.includes("CHECK INFO")) text.title = text.title.replace(review.orderName + " |", review.orderName + " | CHECK INFO |");
  }
  return text;
}

/** Exact evidence comparison only. Model-generated IDs and similar wording are not identity. */
export function migrateReviewDraft(previous: ProductionReview, next: ProductionReview, draft: ReviewDraft): ReviewDraftInput & Pick<ReviewDraft, "previousChoices"> {
  const approval = defaultReviewApproval(next);
  const previousChoices: ReviewDraft["previousChoices"] = [...draft.previousChoices];
  const product = (r: ProductionReview, id: string | null) => r.products.filter(p => id ? p.id === id : true).map(p => ({ id: p.id, quantity: p.quantity, fields: p.fields.map(f => ({ label: f.label, value: f.value })), imageHash: p.imageHash }));
  const evidence = (r: ProductionReview, change: ReviewChange) => change.evidence.map(e => {
    const s = r.sources.find(s => s.id === e.sourceId);
    return { quote: e.quote, kind: s?.kind, text: s?.text, threadId: s?.threadId };
  });
  const key = (r: ProductionReview, c: ReviewChange) => JSON.stringify({ kind: c.kind, productId: c.productId, field: c.field, value: c.value,
    questionOnly: Boolean(c.questionOnly), requiresThreadId: c.requiresThreadId || null, product: product(r, c.productId), evidence: evidence(r, c) });
  for (const old of previous.analysis.changes) {
    const decision = draft.approval.decisions[old.id];
    if (!decision) continue;
    const matches = next.analysis.changes.filter(c => key(previous, old) === key(next, c));
    const boundEvidence = old.evidence.length > 0 && old.evidence.every(e => previous.sources.some(s => s.id === e.sourceId))
      && matches[0]?.evidence.every(e => next.sources.some(s => s.id === e.sourceId));
    if (matches.length === 1 && (boundEvidence || previous.sourceHash === next.sourceHash)) approval.decisions[matches[0].id] = { ...decision };
    else previousChoices.push({ label: old.reason, value: decision.action === "accept" ? `Übernommen: ${old.value || "Hinweis bestätigt"}` : "Selbst geprüft – bisherigen Bestellstand behalten" });
  }
  for (const thread of previous.analysis.threads) {
    const decision = draft.approval.decisions[`thread:${thread.id}`];
    if (!decision) continue;
    const same = next.analysis.threads.find(t => t.id === thread.id && t.relevance === thread.relevance);
    const bodies = (r: ProductionReview) => r.sources.filter(s => s.threadId === thread.id).map(s => [s.id, s.text]);
    if (same && (same.relevance === "uncertain" || next.analysis.changes.some(c => c.requiresThreadId === same.id))
      && JSON.stringify(bodies(previous)) === JSON.stringify(bodies(next))) approval.decisions[`thread:${thread.id}`] = { ...decision };
    else previousChoices.push({ label: thread.reason, value: decision.action === "accept" ? "Gehört zu diesem Auftrag" : "Andere Bestellung" });
  }
  for (const old of previous.attachments) {
    const choice = draft.approval.attachments[old.id];
    if (!choice) continue;
    const match = next.attachments.find(a => a.id === old.id && a.name === old.name && a.url === old.url && a.removable === old.removable);
    const oldDoc = previous.documents?.find(d => d.attachmentId === old.id);
    const newDoc = next.documents?.find(d => d.attachmentId === old.id);
    const sameContent = oldDoc || newDoc ? Boolean(oldDoc?.sha256 && oldDoc.sha256 === newDoc?.sha256) : previous.cardHash === next.cardHash;
    if (match && sameContent) approval.attachments[old.id] = choice;
    else previousChoices.push({ label: old.name, value: choice === "keep" ? "Datei behalten" : "Datei sichern und entfernen" });
  }
  for (const d of next.documents || []) {
    const update = drawingSizeUpdate(next, d, approval.decisions);
    const old = update && draft.approval.decisions[update.id];
    if (update && old?.action === "accept" && old.note === update.note && approval.attachments[d.attachmentId] === "keep") approval.decisions[update.id] = { ...old };
  }
  if (next.products.some(p => p.id === draft.approval.coverProductId && previous.products.some(old => old.id === p.id && old.imageHash === p.imageHash))) approval.coverProductId = draft.approval.coverProductId;
  if (previous.priority === next.priority) { approval.priority = draft.approval.priority; approval.priorityReason = draft.approval.priorityReason; }
  approval.operatorNote = draft.approval.operatorNote;
  Object.assign(approval, draft.edited ? { title: draft.approval.title, description: draft.approval.description } : renderReviewWithAssignment(next, approval.decisions, draft.assignmentNote));
  return { ...reviewDraftContent(draft), approval, manualTextNeedsReview: draft.edited && (draft.manualTextNeedsReview || previous.sourceHash !== next.sourceHash),
    previousChoices: previousChoices.filter((c, i) => previousChoices.findIndex(p => p.label === c.label && p.value === c.value) === i) };
}

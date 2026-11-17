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

export function productionPriorityFromDeliveryTitles(titles: string[]): ProductionPriority {
  return titles.some(title => /express|eilauftrag|eilproduktion|eilversand|\brush\b/i.test(title)
    && !/\b(kein|ohne|no)\b/i.test(title)) ? "express" : "standard";
}

/** Human confirmation of purchased artwork, never an inferred text-to-image mapping. */
export function designMappingQuestions(review: ProductionReview) {
  return review.products.length > 1 ? review.analysis.changes.filter(c => c.questionOnly && !c.requiresThreadId
    && /\b(text(?:e|en|s)?|logo(?:text(?:e|en|s)?)?|schriftzug)\b/i.test(c.reason)
    && /\b(produkt\w*|p\d+)\b/i.test(c.reason)
    && /zuordn|welch|platzier/i.test(c.reason)
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

/** Count actual human actions: one explicit image-batch decision resolves all of its IDs. */
export function reviewOpenStepCount(review: ProductionReview, approval: ReviewApproval, issues: string[]) {
  const images = openImageVariants(review, approval);
  const mapping = designMappingQuestions(review).filter(c => !approval.decisions[c.id]?.note.trim());
  const documents = openDocumentSuggestions(review, approval);
  return Math.max(0, issues.length - Math.max(0, images.length - 1) - Math.max(0, mapping.length - 1) - Math.max(0, documents.length - 1));
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

export function renderProductionReview(review: ProductionReview, decisions: ReviewApproval["decisions"]) {
  const products = review.products.map(p => ({ ...p, fields: p.fields.map(f => ({ ...f })) }));
  const notes: string[] = [];
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
  const title = `${keyCustomer}${review.orderName} | ${sizeUpdate ? "UPDATE NEW SIZE | " : ""}${marker}${review.customerName} | ${summary}`;
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

export function reviewApprovalIssues(review: ProductionReview, approval: ReviewApproval): string[] {
  const issues = [...review.blockers];
  const record = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));
  if (!record(approval) || !(["reviewId", "title", "description", "coverProductId", "priority", "priorityReason", "operatorNote"] as const).every(k => typeof approval[k] === "string")
    || typeof approval.confirmed !== "boolean" || !record(approval.decisions) || !record(approval.attachments)) return ["Ungültiges Freigabeformat."];
  const decisionIds = new Set([...review.analysis.changes.map(c => c.id), ...review.analysis.threads.filter(t => t.relevance === "uncertain").map(t => `thread:${t.id}`)]);
  for (const d of review.documents || []) {
    const update = drawingSizeUpdate(review, d, approval.decisions);
    if (!update) continue;
    decisionIds.add(update.id);
    if (approval.decisions[update.id] && (!update.confirmed || approval.attachments[d.attachmentId] !== "keep")) issues.push("Größen-Update erneut bestätigen und die referenzierte Zeichnung behalten.");
  }
  if (Object.entries(approval.decisions).some(([id, d]) => !decisionIds.has(id) || !record(d) || !["accept", "reject"].includes(String(d.action)) || typeof d.note !== "string" || d.note.length > 2000)
    || Object.keys(approval.attachments).some(id => !review.attachments.some(a => a.id === id))
    || approval.priorityReason.length > 2000 || approval.operatorNote.length > 4000) return ["Ungültige oder zu lange Prüfentscheidung."];
  const updateBlock = sizeUpdateBlock(review, approval.decisions);
  if (updateBlock) {
    const expected = renderProductionReview(review, approval.decisions);
    // Extra assignment notes may sit between the update and the unchanged production body.
    if (approval.title.replace("CHECK INFO | ", "") !== expected.title.replace("CHECK INFO | ", "")
      || !approval.description.startsWith(updateBlock + "\n\n")
      || !approval.description.endsWith(expected.description.slice(updateBlock.length + 2))) {
      issues.push("Größen-Update, Titel und Produktionsmaße müssen übereinstimmen. Automatische Vorschau wiederherstellen.");
    }
  }
  if (approval.reviewId !== review.id) issues.push("Die Vorbereitung ist nicht mehr aktuell.");
  if (!approval.confirmed) issues.push("Bitte die vollständige Vorschau bestätigen.");
  if (!approval.title?.trim() || approval.title.length > 1000 || !approval.description?.trim() || approval.description.length > 16000) issues.push("Titel oder Beschreibung fehlt oder ist zu lang.");
  if (approval.title.split(review.orderName).length !== 2) issues.push("Die Bestellreferenz muss genau einmal im Titel stehen.");
  if (/KEY KUNDE/i.test(review.originalTitle) && !/^KEY KUNDE\s*\|/.test(approval.title)) issues.push("KEY KUNDE muss am Titelanfang erhalten bleiben.");
  if (review.requestId && !approval.description?.includes(`Request-ID: ${review.requestId}`)) issues.push("Die Request-ID muss erhalten bleiben.");
  if (!review.products.some(p => p.id === approval.coverProductId)) issues.push("Bitte ein gekauftes Design als Cover wählen.");
  if (!Object.hasOwn(PRODUCTION_LISTS, approval.priority)) issues.push("Ungültige Produktionsliste.");
  if (approval.priority !== review.priority && !approval.priorityReason?.trim()) issues.push("Bitte die abweichende Priorität begründen.");
  for (const change of review.analysis.changes) {
    const decision = approval.decisions?.[change.id];
    if (!decision || !["accept", "reject"].includes(decision.action)) issues.push(`Entscheidung fehlt: ${change.reason}`);
    else if (change.questionOnly && !decision.note?.trim()) issues.push(`Klärung dokumentieren: ${change.reason}`);
    if (change.requiresThreadId && decision?.action === "accept" && approval.decisions[`thread:${change.requiresThreadId}`]?.action !== "accept") issues.push("Die Logo-Korrektur muss diesem Auftrag ausdrücklich zugeordnet werden.");
  }
  for (const thread of review.analysis.threads.filter(t => t.relevance === "uncertain" && !review.analysis.changes.some(c => c.requiresThreadId === t.id))) {
    const decision = approval.decisions?.[`thread:${thread.id}`];
    if (!decision || (decision.action === "accept" && !decision.note.trim())) issues.push(`Mailzuordnung klären: ${thread.reason}`);
  }
  for (const attachment of review.attachments) {
    if (!["keep", "remove"].includes(approval.attachments?.[attachment.id])) issues.push(`Datei prüfen: ${reviewAttachmentLabel(review, attachment)}`);
    if (approval.attachments?.[attachment.id] === "remove" && attachment.removable === false) issues.push(`Diese Datei muss erhalten bleiben: ${reviewAttachmentLabel(review, attachment)}`);
  }
  return [...new Set(issues)];
}

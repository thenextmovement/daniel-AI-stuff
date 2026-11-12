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
  const marker = notes.length ? "CHECK INFO | " : "";
  const title = `${keyCustomer}${review.orderName} | ${marker}${review.customerName} | ${summary}`;
  const blocks = products.map((p, i) => [
    products.length > 1 ? `Product ${i + 1}: ${p.title}` : p.title,
    ...p.fields.map(f => `${f.label}: ${f.value}`),
    `Quantity: ${p.quantity} Piece${p.quantity === 1 ? "" : "s"}`,
  ].join("\n"));
  const description = [
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
  if (Object.entries(approval.decisions).some(([id, d]) => !decisionIds.has(id) || !record(d) || !["accept", "reject"].includes(String(d.action)) || typeof d.note !== "string" || d.note.length > 2000)
    || Object.keys(approval.attachments).some(id => !review.attachments.some(a => a.id === id))
    || approval.priorityReason.length > 2000 || approval.operatorNote.length > 4000) return ["Ungültige oder zu lange Prüfentscheidung."];
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
    if (!["keep", "remove"].includes(approval.attachments?.[attachment.id])) issues.push(`Datei prüfen: ${attachment.name}`);
    if (approval.attachments?.[attachment.id] === "remove" && attachment.removable === false) issues.push(`Diese Datei muss erhalten bleiben: ${attachment.name}`);
  }
  return [...new Set(issues)];
}

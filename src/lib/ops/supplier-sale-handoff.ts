import { createHash } from "node:crypto";
import type { ProductionTrelloCard } from "@/lib/quotes/trello";
import type { SupplierFileBackup } from "./supplier-sale-files";
import { PRODUCTION_LISTS, QUENTIN_REVIEW_BOARD, type ProductionReview, type ReviewApproval } from "./supplier-sale-review";

export type ProductionHandoff = {
  reviewId: string; attemptKey: string; approvalHash: string;
  status: "pending" | "partial" | "synced"; error: string | null;
  uploads: Record<string, string>; backups: SupplierFileBackup[];
  releaseAttempted: boolean; verifiedAt: string | null;
};
export type HandoffDependencies = {
  readCard(): Promise<ProductionTrelloCard>;
  upload(url: string, name: string): Promise<{ id: string }>;
  readFile(attachment: ProductionTrelloCard["attachments"][number]): Promise<{ bytes: Uint8Array; contentType: string }>;
  backup(attachment: ProductionTrelloCard["attachments"][number]): Promise<SupplierFileBackup>;
  verifyBackup(backup: SupplierFileBackup): Promise<unknown>;
  update(patch: { name?: string; desc?: string; idAttachmentCover?: string; idList?: string; pos?: "top" }): Promise<unknown>;
  remove(id: string): Promise<unknown>;
  verifyShopify(): Promise<unknown>;
  checkSources(): Promise<unknown>;
  isTop(listId: string, cardId: string): Promise<boolean>;
  save(state: ProductionHandoff): Promise<unknown>;
};
export function approvedDesignAttachmentName(productId: string, imageHash: string) {
  return `Approved Design ${productId.slice(-8)} ${imageHash.slice(0, 16)}`;
}

/** Resumes the existing assignment attempt by reading provider effects, never by assuming success. */
export async function executeProductionHandoff(review: ProductionReview, approval: ReviewApproval, state: ProductionHandoff, deps: HandoffDependencies) {
  const target = PRODUCTION_LISTS[approval.priority].id;
  const originalIds = new Set(review.attachments.map(a => a.id));
  const removedIds = new Set(review.attachments.filter(a => approval.attachments[a.id] === "remove").map(a => a.id));
  const designNames = new Set(review.products.map(p => approvedDesignAttachmentName(p.id, p.imageHash)));
  function checkCard(card: ProductionTrelloCard) {
    if (card.id !== review.cardId || card.idBoard !== QUENTIN_REVIEW_BOARD || card.closed) throw new Error("Die Produktionskarte ist nicht mehr eindeutig verfügbar.");
    if (![review.originalListId, ...(state.releaseAttempted ? [target] : [])].includes(card.idList)) throw new Error("Die Karte wurde zwischenzeitlich verschoben.");
    if (![review.originalTitle, approval.title].includes(card.name) || ![review.originalDescription, approval.description].includes(card.desc)) throw new Error("Die Karte wurde zwischenzeitlich bearbeitet. Bitte neu prüfen.");
    if (card.attachments.some(a => !originalIds.has(a.id) && !designNames.has(a.name || ""))) throw new Error("Neue Datei auf der Karte. Bitte neu prüfen.");
    for (const id of originalIds) {
      if (!card.attachments.some(a => a.id === id) && (!removedIds.has(id) || !state.backups.some(b => b.attachmentId === id))) throw new Error("Eine ursprüngliche Datei fehlt ohne bestätigte Sicherung.");
    }
    const expectedCover = state.uploads[approval.coverProductId];
    if (card.idAttachmentCover && ![review.originalCoverId, expectedCover].includes(card.idAttachmentCover)) throw new Error("Das Cover wurde zwischenzeitlich geändert.");
  }
  async function read() { const card = await deps.readCard(); checkCard(card); return card; }
  async function save() { await deps.save({ ...state, uploads: { ...state.uploads }, backups: [...state.backups] }); }
  try {
    let card = await read();
    if (state.releaseAttempted && card.idList === target) {
      if (card.name !== approval.title || card.desc !== approval.description
        || card.idAttachmentCover !== state.uploads[approval.coverProductId]
        || [...removedIds].some(id => card.attachments.some(a => a.id === id))
        || Object.values(state.uploads).some(id => !card.attachments.some(a => a.id === id))
        || !(await deps.isTop(target, card.id))) throw new Error("Die Produktion wurde möglicherweise bereits ausgelöst. Den veränderten Kartenstand manuell prüfen.");
      state.status = "synced"; state.error = null; state.verifiedAt = new Date().toISOString();
      await save();
      return state;
    }
    // Reconcile an upload even when its HTTP response or the following DB write was lost.
    for (const product of review.products) {
      const name = approvedDesignAttachmentName(product.id, product.imageHash);
      const candidates = card.attachments.filter(a => !removedIds.has(a.id) && (a.id === state.uploads[product.id] || a.name === name));
      if (candidates.length > 1) throw new Error("Mehrdeutiger Approved-Design-Anhang. Bitte manuell prüfen.");
      let attachment = candidates[0];
      if (!attachment) {
        const uploaded = await deps.upload(product.imageUrl, name);
        card = await read();
        attachment = card.attachments.find(a => a.id === uploaded.id)!;
      }
      if (!attachment) throw new Error("Approved Design konnte nach dem Upload nicht zurückgelesen werden.");
      const file = await deps.readFile(attachment);
      if (createHash("sha256").update(file.bytes).digest("hex") !== product.imageHash) throw new Error("Approved Design stimmt nicht mit dem geprüften gekauften Bild überein.");
      state.uploads[product.id] = attachment.id;
      await save();
    }
    // Back up every removal before changing the contents; the original snapshot is in the assignment attempt.
    for (const id of removedIds) {
      let backup = state.backups.find(b => b.attachmentId === id);
      if (!backup) {
        card = await read();
        const attachment = card.attachments.find(a => a.id === id);
        if (!attachment) throw new Error("Die zu sichernde Datei fehlt.");
        backup = await deps.backup(attachment);
        state.backups.push(backup);
        await save();
      }
      await deps.verifyBackup(backup);
    }
    const coverId = state.uploads[approval.coverProductId];
    card = await read();
    if (card.name !== approval.title || card.desc !== approval.description || card.idAttachmentCover !== coverId) {
      await deps.update({ name: approval.title, desc: approval.description, idAttachmentCover: coverId });
    }
    for (const id of removedIds) {
      card = await read();
      if (!card.attachments.some(a => a.id === id)) continue;
      await deps.verifyBackup(state.backups.find(b => b.attachmentId === id)!);
      await deps.remove(id);
    }
    function verifyContent(c: ProductionTrelloCard) {
      if (c.name !== approval.title || c.desc !== approval.description || c.idAttachmentCover !== coverId
        || [...removedIds].some(id => c.attachments.some(a => a.id === id))
        || Object.values(state.uploads).some(id => !c.attachments.some(a => a.id === id))) throw new Error("Der freigegebene Karteninhalt wurde nicht vollständig bestätigt.");
    }
    card = await read();
    verifyContent(card);
    await deps.verifyShopify();
    await deps.checkSources();
    card = await read();
    verifyContent(card);
    if (!(state.releaseAttempted && card.idList === target && await deps.isTop(target, card.id))) {
      state.releaseAttempted = true;
      await save();
      // Last external release action. Do not move back as an automatic rollback.
      await deps.update({ idList: target, pos: "top" });
    }
    card = await read();
    verifyContent(card);
    if (card.idList !== target || !(await deps.isTop(target, card.id))) throw new Error("Die Position oben in der Produktionsliste wurde nicht bestätigt.");
    state.status = "synced"; state.error = null; state.verifiedAt = new Date().toISOString();
    await save();
    return state;
  } catch (error) {
    state.status = "partial";
    state.error = error instanceof Error ? error.message : "Produktionsübergabe unvollständig.";
    await save();
    throw error;
  }
}

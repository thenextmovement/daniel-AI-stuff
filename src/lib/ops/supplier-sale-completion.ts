export const SUPPLIER_SALE_COMPLETION_HOLD_MS = 10 * 60 * 1000;

export type SupplierSaleCompletionSnapshot = {
  assignmentStatus: string;
  assignedSupplier: string | null;
  shopifyTagSyncStatus: string;
  trelloProjectionStatus: string;
  supplierTrelloCardId: string | null;
  supplierTrelloCardUrl: string | null;
  productionConfirmedAt: string | null;
  manualShopifySupplierTagConfirmedAt: string | null;
};

export function supplierSaleShopifyConfirmed(sale: SupplierSaleCompletionSnapshot) {
  if (sale.assignedSupplier === "special") return Boolean(sale.manualShopifySupplierTagConfirmedAt);
  return sale.shopifyTagSyncStatus === "synced";
}

export function supplierSaleTrelloConfirmed(sale: SupplierSaleCompletionSnapshot) {
  return sale.trelloProjectionStatus === "synced" && Boolean(sale.supplierTrelloCardId || sale.supplierTrelloCardUrl);
}

export function supplierSaleReadyForProduction(sale: SupplierSaleCompletionSnapshot) {
  return (
    sale.assignmentStatus === "assigned" &&
    Boolean(sale.assignedSupplier) &&
    supplierSaleShopifyConfirmed(sale) &&
    supplierSaleTrelloConfirmed(sale)
  );
}

export function supplierSaleCompletionHideAt(sale: Pick<SupplierSaleCompletionSnapshot, "productionConfirmedAt">) {
  const confirmedAt = sale.productionConfirmedAt ? new Date(sale.productionConfirmedAt).getTime() : NaN;
  if (!Number.isFinite(confirmedAt)) return null;
  return new Date(confirmedAt + SUPPLIER_SALE_COMPLETION_HOLD_MS).toISOString();
}

export function supplierSaleVisibleInActiveOverview(
  sale: Pick<SupplierSaleCompletionSnapshot, "assignmentStatus" | "productionConfirmedAt">,
  now = new Date(),
) {
  if (["completed", "canceled"].includes(sale.assignmentStatus)) return false;
  if (sale.assignmentStatus !== "in_production") return true;
  const hideAt = supplierSaleCompletionHideAt(sale);
  return !hideAt || new Date(hideAt).getTime() > now.getTime();
}

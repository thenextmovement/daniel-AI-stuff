import type { SupplierSale, SupplierSaleSupplier } from "./supplier-sales";

export type SupplierSelection = SupplierSaleSupplier | "";

type SupplierSelectionSale = Pick<SupplierSale, "assignedSupplier" | "recommendedSupplier" | "productSummary" | "items">;

export function isConfiguratorSale(sale: SupplierSelectionSale) {
  const searchable = [
    sale.productSummary,
    ...sale.items.flatMap((item) => [item.title, item.sku, item.variantTitle, item.description, ...item.selectionDetails]),
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();

  return /\b(?:konfigurator|configurator)\b/.test(searchable) || searchable.includes("_cpc");
}

export function defaultSupplierSelection(sale: SupplierSelectionSale): SupplierSelection {
  if (sale.assignedSupplier) return sale.assignedSupplier;
  if (isConfiguratorSale(sale)) return "";
  if (sale.recommendedSupplier === "quentin") return "quentin";
  if (sale.recommendedSupplier === "said") return "said";
  return "said";
}

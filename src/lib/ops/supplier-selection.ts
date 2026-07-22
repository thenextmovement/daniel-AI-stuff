import type { SupplierSale, SupplierSaleSupplier } from "./supplier-sales";

export type SupplierSelection = SupplierSaleSupplier | "";

type SupplierSelectionSale = Pick<SupplierSale, "assignedSupplier" | "recommendedSupplier" | "productSummary" | "totalPrice" | "items">;

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
  return "quentin";
}

export function shouldSuggestSaeid(sale: SupplierSelectionSale) {
  if (Number(sale.totalPrice || 0) <= 1000) return false;

  const searchable = [
    sale.productSummary,
    ...sale.items.flatMap((item) => [item.title, item.sku, item.variantTitle, item.description, ...item.selectionDetails]),
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss");

  const isNeonFlex = /led[\s-]*neon|neon[\s-]*flex|neonflex|neon schriftzug|neonschild/.test(searchable);
  const isExplicitlyIndoor = /\bindoor\b|\binnenbereich\b|\bdrinnen\b|\beinsatzort:\s*innen/.test(searchable);
  const hasExcludedProduct = /\b3d\b|backlit|frontlit|non[\s-]*lit|light[\s-]*box|leuchtkasten|profilbuchstaben/.test(searchable);
  const isOutdoor = /\boutdoor\b|\baussen\b|\bwetterfest\b|\bwasserdicht\b|\bip6[457]\b/.test(searchable);
  const isMulticolor = /\brgbw?\b|mehrfarbig|multicolor|multi[\s-]*color|color as logo|farbe wie logo|farbverlauf/.test(searchable);
  const hasExplicitSingleColor = /\b(?:color|farbe|leuchtfarbe):\s*(?:warm white|warmweiss|cold white|kaltweiss|weiss|white|red|rot|orange|yellow|gelb|green|gruen|blue|blau|ice blue|eisblau|pink|rosa|purple|lila|violett)\b/.test(searchable);

  return isNeonFlex && isExplicitlyIndoor && hasExplicitSingleColor && !hasExcludedProduct && !isOutdoor && !isMulticolor;
}

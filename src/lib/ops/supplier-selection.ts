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

function normalizedSupplierText(values: Array<string | null | undefined>) {
  return values
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss");
}

function supplierItemText(item: SupplierSelectionSale["items"][number]) {
  return normalizedSupplierText([
    item.title,
    item.sku,
    item.variantTitle,
    item.productType,
    item.description,
    ...item.selectionDetails,
  ]);
}

function supplierItemIdentity(item: SupplierSelectionSale["items"][number]) {
  return normalizedSupplierText([
    item.title,
    item.sku,
    item.variantTitle,
    item.productType,
    item.description,
  ]);
}

function isNonSignSupplierLine(item: SupplierSelectionSale["items"][number]) {
  const identity = supplierItemIdentity(item);
  const isRecognizableSign = /led[\s-]*neon|neon[\s-]*flex|neonflex|neon schriftzug|neonschild|leuchtschild|sign design|schild design|\b3d\b|backlit|frontlit|non[\s-]*lit|light[\s-]*box|leuchtkasten|profilbuchstaben/.test(identity);
  if (isRecognizableSign) return false;
  return /\b(?:shipping|delivery|versand|liefertermin|standardlieferung|express|eilauftrag|priorisierte produktion|priority production|dimmer|fernbedienung|remote control|controller|netzteil|power supply|klebe[\s-]*set|adhesive(?: mounting)?(?: kit| strips?)?|hanging set|haenge[\s-]*set|aufhaeng|wandmontage|wall mount|mounting kit|kabelverlaengerung|cable extension|kabelabgang|cable position|feinzuschnitt|cut to shape|cut to letter)\b/.test(identity);
}

function isEligibleSaeidNeonFlexItem(item: SupplierSelectionSale["items"][number]) {
  const text = supplierItemText(item);
  const isNeonFlex = /led[\s-]*neon|neon[\s-]*flex|neonflex|neon schriftzug|neonschild/.test(text);
  const isExplicitlyIndoor = /\bindoor\b|\binnenbereich\b|\bdrinnen\b|\beinsatzort:\s*innen/.test(text);
  const isOutdoor = /\boutdoor\b|\baussen\b|\bwetterfest\b|\bwasserdicht\b|\bwasserfest\b|\bip6[457]\b/.test(text);
  const isMulticolor = /\brgbw?\b|mehrfarbig|multicolor|multi[\s-]*color|color as logo|farbe wie logo|farbverlauf/.test(text);
  const hasExplicitSingleColor = /\b(?:color|farbe|leuchtfarbe):\s*(?:warm white|warmweiss|cold white|kaltweiss|weiss|white|red|rot|orange|yellow|gelb|green|gruen|blue|blau|ice blue|eisblau|pink|rosa|purple|lila|violett)\b/.test(text);

  return isNeonFlex && isExplicitlyIndoor && hasExplicitSingleColor && !isOutdoor && !isMulticolor;
}

export function shouldSuggestSaeid(sale: SupplierSelectionSale) {
  if (Number(sale.totalPrice || 0) <= 1000) return false;

  const orderText = normalizedSupplierText([
    sale.productSummary,
    ...sale.items.flatMap((item) => [item.title, item.sku, item.variantTitle, item.description, ...item.selectionDetails]),
  ]);
  const hasHardExclusion = /\brgbw?\b|mehrfarbig|multicolor|multi[\s-]*color|color as logo|farbe wie logo|farbverlauf|\boutdoor\b|\baussen\b|\bwetterfest\b|\bwasserdicht\b|\bwasserfest\b|\bip6[457]\b/.test(orderText);
  if (hasHardExclusion) return false;

  const productionItems = sale.items.filter((item) => !isNonSignSupplierLine(item));
  return productionItems.length > 0 && productionItems.every(isEligibleSaeidNeonFlexItem);
}

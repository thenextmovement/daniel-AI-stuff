import {
  calculateExpressShipping,
  calculatePriorityShipping,
  calculateRgbPrice,
  calculateSalePrice,
  parsePrice,
  roundDownToFive,
} from "./pricing";
import type { CustomFieldMap, QuoteItemInput } from "./types";

function fieldValue(customFields: CustomFieldMap, name: string) {
  const raw = customFields[name] ?? customFields[name.toLowerCase()];
  return raw === null || raw === undefined ? "" : String(raw).trim();
}

function descriptionLine(label: string, value: string) {
  return value ? `${label}: ${value}` : "";
}

function firstBasePrice(customFields: CustomFieldMap) {
  return parsePrice(customFields.Price_1 ?? customFields.price_1) ?? 0;
}

function secondBasePrice(customFields: CustomFieldMap) {
  return parsePrice(customFields.Price_2 ?? customFields.price_2);
}

export function buildProductItems(
  customFields: CustomFieldMap,
  options: { factor: number; taxRate: number },
): QuoteItemInput[] {
  const items: QuoteItemInput[] = [];
  const usage = fieldValue(customFields, "Usage");

  for (let index = 1; index <= 4; index += 1) {
    const basePrice = parsePrice(customFields[`Price_${index}`] ?? customFields[`price_${index}`]);
    const size = fieldValue(customFields, `Size_${index}`);

    if (!basePrice || basePrice <= 0 || !size) continue;

    const color = fieldValue(customFields, `Color_${index}`);
    const backboard = fieldValue(customFields, `Backboard_${index}`);
    const description = [
      descriptionLine("Größe", size),
      descriptionLine("Leuchtfarbe", color),
      descriptionLine("Rückplatte", backboard),
      descriptionLine("Einsatzbereich", usage),
    ]
      .filter(Boolean)
      .join("\n");

    items.push({
      id: `design_${index}`,
      section: "products",
      name: `LED-Leuchtschild inkl. 25% Rabatt Design #${index}`,
      description,
      quantity: 1,
      unit_price: calculateSalePrice(basePrice, options.factor),
      tax_rate: options.taxRate,
      optional: true,
      selected_default: true,
      quantity_editable: true,
      sort_order: index * 10,
      metadata: {
        design_index: index,
        base_price: basePrice,
        size,
        color,
        backboard,
        usage,
      },
    });
  }

  return items;
}

export function buildAddonItems(
  customFields: CustomFieldMap,
  options: { factor: number; taxRate: number },
): QuoteItemInput[] {
  const basePrice = firstBasePrice(customFields);
  const rgbPrice = calculateRgbPrice(basePrice, options.factor);
  const addonSpecs = [
    ["dimmer", "Dimmer & Fernbedienung", "Stufenlose Helligkeitssteuerung für Ihr Leuchtschild.", 45, false],
    ["rgb", "RGB-Option", "Mehrfarbige LED-Option mit Steuerung statt einfarbiger Beleuchtung.", rgbPrice, false],
    ["wall_mount", "Wandmontage-Set", "Befestigungsmaterial und Abstandshalter für eine saubere Montage.", 35, true],
    ["extra_cable", "Zusätzliche Kabellänge", "Mehr Flexibilität bei verdeckter Verkabelung und Netzteilposition.", 25, false],
    ["ceiling", "Deckenabhängung", "Abhängeset für Montage an Decken oder Traversen.", 65, false],
    ["adhesive", "Klebe-Set", "Montagekleber und Zubehör für glatte Innenflächen.", 25, false],
    ["power_supply", "Weißes oder schwarzes Netzteil", "Netzteil farblich passend zur Umgebung auswählen.", 20, false],
    ["stand", "Tischständer", "Freistehende Präsentation auf Empfangstresen oder Messefläche.", 55, false],
    ["warranty", "Garantieverlängerung", "Zusätzliche Absicherung über die reguläre Gewährleistung hinaus.", 95, false],
    ["neutral_packaging", "Neutrale Verpackung", "Versand ohne sichtbares NEONTRIP Branding.", 20, false],
    ["eco_shipping", "ECO-Versand", "CO2-bewusstere Versandabwicklung, sofern verfügbar.", 15, false],
  ] as const;

  return addonSpecs.map(([slug, name, description, price, selectedDefault], index) => ({
    id: `addon_${slug}`,
    section: "addons",
    name,
    description,
    quantity: 1,
    unit_price: roundDownToFive(price),
    tax_rate: options.taxRate,
    optional: true,
    selected_default: selectedDefault,
    quantity_editable: false,
    sort_order: 100 + index * 10,
    metadata: {
      addon_slug: slug,
      calculated_from_price_1: slug === "rgb" ? basePrice : undefined,
    },
  }));
}

export function buildShippingItems(
  customFields: CustomFieldMap,
  options: { factor: number; taxRate: number },
): QuoteItemInput[] {
  const type = fieldValue(customFields, "Type").toLowerCase();
  const is3d = type === "3d";
  const price1 = firstBasePrice(customFields);
  const price2 = secondBasePrice(customFields);

  const items: QuoteItemInput[] = [
    {
      id: "shipping_standard",
      section: "shipping",
      name: "Standard-Versand",
      description: "Versicherter Standardversand nach Fertigstellung.",
      quantity: 1,
      unit_price: 0,
      tax_rate: options.taxRate,
      optional: true,
      selected_default: true,
      quantity_editable: false,
      sort_order: 300,
      metadata: { shipping_slug: "standard" },
    },
  ];

  if (!is3d) {
    items.push(
      {
        id: "shipping_express",
        section: "shipping",
        name: "Express-Versand",
        description: "Schnellere Versandabwicklung nach Produktionsabschluss.",
        quantity: 1,
        unit_price: calculateExpressShipping(price1),
        tax_rate: options.taxRate,
        optional: true,
        selected_default: false,
        quantity_editable: false,
        sort_order: 310,
        metadata: { shipping_slug: "express", calculated_from_price_1: price1 },
      },
      {
        id: "shipping_priority",
        section: "shipping",
        name: "Eilauftrag / Prio",
        description: "Priorisierte Projektabwicklung fuer zeitkritische Termine.",
        quantity: 1,
        unit_price: calculatePriorityShipping(price2, options.factor),
        tax_rate: options.taxRate,
        optional: true,
        selected_default: false,
        quantity_editable: false,
        sort_order: 320,
        metadata: { shipping_slug: "priority", calculated_from_price_2: price2 },
      },
    );
  }

  return items;
}

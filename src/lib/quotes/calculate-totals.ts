import type { QuoteItemRecord, QuoteSelectionInput, QuoteTotals } from "./types";

function money(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateQuoteTotals(
  items: QuoteItemRecord[],
  selections: QuoteSelectionInput[],
): QuoteTotals {
  const selectionById = new Map(selections.map((selection) => [selection.item_id, selection]));
  let subtotal = 0;
  let tax = 0;

  for (const item of items) {
    const selection = selectionById.get(item.id);
    const selected = selection ? selection.selected : item.selected_default;
    if (!selected) continue;

    const quantity = selection ? selection.quantity : item.quantity;
    const lineNet = Number(item.unit_price) * Number(quantity);
    subtotal += lineNet;
    tax += lineNet * (Number(item.tax_rate) / 100);
  }

  return {
    subtotal_net: money(subtotal),
    tax_amount: money(tax),
    total_gross: money(subtotal + tax),
  };
}

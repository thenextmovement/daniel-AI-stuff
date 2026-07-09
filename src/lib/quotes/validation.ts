import { isValidEmail } from "./customer";
import type { AcceptQuotePayload, AddressInput, QuoteItemRecord, QuoteSelectionInput } from "./types";

export class QuoteValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: string[] = [message],
    public readonly status = 400,
  ) {
    super(message);
    this.name = "QuoteValidationError";
  }
}

export function assertQuoteCreationInput(input: {
  requestId?: string | null;
  email?: string | null;
  productCount: number;
  allowManyProducts?: boolean;
}) {
  const issues: string[] = [];
  if (!input.requestId) issues.push("request_id fehlt.");
  if (!input.email || !isValidEmail(input.email)) issues.push("Gueltige Kunden-E-Mail fehlt.");
  if (input.productCount < 1) issues.push("Mindestens ein Produktpreis muss vorhanden sein.");
  if (input.productCount > 4 && !input.allowManyProducts) issues.push("Maximal vier Produktvarianten sind erlaubt.");
  if (issues.length) throw new QuoteValidationError("Quote kann nicht erstellt werden.", issues);
}

export function isCompleteAddress(address: Partial<AddressInput> | undefined): address is AddressInput {
  if (!address) return false;
  return ["first_name", "last_name", "street", "postal_code", "city", "country"].every(
    (key) => String(address[key as keyof AddressInput] || "").trim().length > 0,
  );
}

export function validateSelections(items: QuoteItemRecord[], selections: QuoteSelectionInput[]) {
  const itemById = new Map(items.map((item) => [item.id, item]));
  const issues: string[] = [];

  for (const selection of selections) {
    const item = itemById.get(selection.item_id);
    if (!item) {
      issues.push(`Unbekannte Position: ${selection.item_id}`);
      continue;
    }

    if (!Number.isFinite(selection.quantity) || selection.quantity < 1) {
      issues.push(`Ungueltige Menge fuer ${item.name}.`);
    }

    if (!item.quantity_editable && selection.quantity !== Number(item.quantity)) {
      issues.push(`Menge fuer ${item.name} darf nicht geaendert werden.`);
    }
  }

  const hasRelevantSelection = selections.some((selection) => {
    const item = itemById.get(selection.item_id);
    return selection.selected && item && (Number(item.unit_price) > 0 || item.section === "products");
  });

  if (!hasRelevantSelection) issues.push("Mindestens eine relevante Angebotsposition muss ausgewaehlt sein.");
  if (issues.length) throw new QuoteValidationError("Auswahl ist ungueltig.", issues);
}

export function validateAcceptQuotePayload(items: QuoteItemRecord[], payload: AcceptQuotePayload) {
  const issues: string[] = [];

  if (!payload.terms_accepted) issues.push("Bestaetigung/AGB muss akzeptiert werden.");
  if (!isCompleteAddress(payload.delivery_address)) issues.push("Lieferadresse ist unvollstaendig.");
  if (!isCompleteAddress(payload.billing_address)) issues.push("Rechnungsadresse ist unvollstaendig.");
  if (!String(payload.signed_name || "").trim()) issues.push("Signatur fehlt.");

  try {
    validateSelections(items, payload.selected_items || []);
  } catch (error) {
    if (error instanceof QuoteValidationError) issues.push(...error.issues);
    else throw error;
  }

  if (issues.length) throw new QuoteValidationError("Angebot kann nicht angenommen werden.", issues);
}

export function assertAcceptableStatus(status: string) {
  if (["accepted", "declined", "expired", "void"].includes(status)) {
    throw new QuoteValidationError("Dieses Angebot kann nicht mehr angenommen werden.", [], 409);
  }
}

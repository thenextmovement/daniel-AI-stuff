"use client";

import { useMemo, useState } from "react";
import { QuoteHeader } from "./QuoteHeader";
import { CustomerIntro } from "./CustomerIntro";
import { MockupGallery } from "./MockupGallery";
import { QuoteItemSection, type ItemUiState } from "./QuoteItemSection";
import { QuoteSummary } from "./QuoteSummary";
import { AcceptQuotePanel } from "./AcceptQuotePanel";
import { emptyAddress } from "./AddressForm";
import { calculateQuoteTotals } from "@/lib/quotes/calculate-totals";
import { getTaxRate } from "@/lib/quotes/tax";
import { isCompleteAddress } from "@/lib/quotes/validation";
import type { AddressInput, PublicQuote, QuoteItemRecord, QuoteSelectionInput } from "@/lib/quotes/types";

function initialState(items: QuoteItemRecord[]): ItemUiState {
  return Object.fromEntries(
    items.map((item) => [
      item.id,
      {
        selected: item.selected_default,
        quantity: Number(item.quantity),
      },
    ]),
  );
}

function selectionsFromState(items: QuoteItemRecord[], state: ItemUiState): QuoteSelectionInput[] {
  return items.map((item) => ({
    item_id: item.id,
    selected: state[item.id]?.selected ?? item.selected_default,
    quantity: state[item.id]?.quantity ?? Number(item.quantity),
  }));
}

function hasRelevantSelection(items: QuoteItemRecord[], selections: QuoteSelectionInput[]) {
  const itemById = new Map(items.map((item) => [item.id, item]));
  return selections.some((selection) => {
    const item = itemById.get(selection.item_id);
    return selection.selected && item && (Number(item.unit_price) > 0 || item.section === "products");
  });
}

function singleSelectGroup(item: QuoteItemRecord) {
  if (item.section === "shipping") return "shipping";
  return typeof item.metadata?.selection_group === "string" && item.metadata?.selection_mode === "single"
    ? item.metadata.selection_group
    : null;
}

export function QuotePage({ quote }: { quote: PublicQuote }) {
  const [state, setState] = useState<ItemUiState>(() => initialState(quote.items));
  const [deliveryAddress, setDeliveryAddress] = useState<AddressInput>(() => emptyAddress(quote.country));
  const [billingAddress, setBillingAddress] = useState<AddressInput>(() => emptyAddress(quote.country));
  const [sameBilling, setSameBilling] = useState(false);
  const [signedName, setSignedName] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const products = quote.items.filter((item) => item.section === "products");
  const addons = quote.items.filter((item) => item.section === "addons");
  const shipping = quote.items.filter((item) => item.section === "shipping");

  const selections = useMemo(() => selectionsFromState(quote.items, state), [quote.items, state]);
  const totals = useMemo(() => calculateQuoteTotals(quote.items, selections), [quote.items, selections]);
  const effectiveBilling = sameBilling ? deliveryAddress : billingAddress;
  const canAccept =
    quote.status !== "accepted" &&
    hasRelevantSelection(quote.items, selections) &&
    isCompleteAddress(deliveryAddress) &&
    isCompleteAddress(effectiveBilling) &&
    Boolean(signedName.trim()) &&
    termsAccepted;

  function toggleItem(item: QuoteItemRecord, selected: boolean) {
    setState((current) => {
      const group = singleSelectGroup(item);
      if (!group) {
        return { ...current, [item.id]: { ...(current[item.id] || {}), selected } };
      }

      return Object.fromEntries(
        quote.items.map((candidate) => [
          candidate.id,
          {
            selected:
              singleSelectGroup(candidate) === group
                ? candidate.id === item.id
                : current[candidate.id]?.selected ?? candidate.selected_default,
            quantity: current[candidate.id]?.quantity ?? Number(candidate.quantity),
          },
        ]),
      );
    });
  }

  function changeQuantity(item: QuoteItemRecord, quantity: number) {
    setState((current) => ({
      ...current,
      [item.id]: {
        selected: current[item.id]?.selected ?? item.selected_default,
        quantity: Math.max(1, quantity),
      },
    }));
  }

  function changeDeliveryAddress(address: AddressInput) {
    setDeliveryAddress(address);
    if (sameBilling) setBillingAddress(address);
  }

  function changeSameBilling(value: boolean) {
    setSameBilling(value);
    if (value) setBillingAddress(deliveryAddress);
  }

  async function accept() {
    setIsSubmitting(true);
    setError("");

    try {
      const response = await fetch(`/api/quotes/${quote.share_token}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selected_items: selections,
          delivery_address: deliveryAddress,
          billing_address: effectiveBilling,
          signed_name: signedName,
          signature_created_client_at: new Date().toISOString(),
          signature_style: "script-css-v1",
          terms_accepted: termsAccepted,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) {
        throw new Error(result.issues?.[0] || result.error || "Annahme fehlgeschlagen.");
      }
      window.location.assign(`/quote/${quote.share_token}/accepted`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Annahme fehlgeschlagen.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="quote-shell min-h-screen bg-[#f6f4ef] text-neutral-950">
      <QuoteHeader quote={quote} />
      <CustomerIntro quote={quote} />

      <div className="mx-auto grid w-full max-w-7xl gap-6 px-5 pb-12 md:px-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <MockupGallery images={quote.images} />
          <QuoteItemSection
            section="products"
            items={products}
            state={state}
            currency={quote.currency}
            onToggle={toggleItem}
            onQuantityChange={changeQuantity}
          />
          <QuoteItemSection
            section="addons"
            items={addons}
            state={state}
            currency={quote.currency}
            onToggle={toggleItem}
            onQuantityChange={changeQuantity}
          />
          <QuoteItemSection
            section="shipping"
            items={shipping}
            state={state}
            currency={quote.currency}
            onToggle={toggleItem}
            onQuantityChange={changeQuantity}
          />
          <AcceptQuotePanel
            customerName={quote.customer_name}
            deliveryAddress={deliveryAddress}
            billingAddress={effectiveBilling}
            sameBilling={sameBilling}
            signedName={signedName}
            termsAccepted={termsAccepted}
            canAccept={canAccept}
            isSubmitting={isSubmitting}
            error={error}
            onDeliveryChange={changeDeliveryAddress}
            onBillingChange={setBillingAddress}
            onSameBillingChange={changeSameBilling}
            onSign={setSignedName}
            onTermsChange={setTermsAccepted}
            onAccept={accept}
          />
        </div>

        <div className="lg:pt-0">
          <QuoteSummary totals={totals} currency={quote.currency} taxRate={getTaxRate(quote.country)} />
        </div>
      </div>

      <footer className="border-t border-black/10 bg-white">
        <div className="mx-auto grid max-w-7xl gap-6 px-5 py-8 text-sm text-neutral-600 md:grid-cols-3 md:px-8">
          <p>
            <strong className="block text-neutral-950">Kontakt</strong>
            support@neontrip.de · 0211 54257240
          </p>
          <p>
            <strong className="block text-neutral-950">Lieferzeit</strong>
            Abhängig von Auswahl, Material und Produktionsfreigabe.
          </p>
          <p>
            <strong className="block text-neutral-950">Rechtliches</strong>
            Es gelten die NEONTRIP Bedingungen und projektbezogene Produktionshinweise.
          </p>
        </div>
      </footer>
    </main>
  );
}

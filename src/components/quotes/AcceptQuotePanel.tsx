"use client";

import { CheckCircle2, Loader2 } from "lucide-react";
import { AddressForm } from "./AddressForm";
import { SignatureBox } from "./SignatureBox";
import type { AddressInput } from "@/lib/quotes/types";

export function AcceptQuotePanel({
  customerName,
  deliveryAddress,
  billingAddress,
  sameBilling,
  signedName,
  termsAccepted,
  canAccept,
  isSubmitting,
  error,
  onDeliveryChange,
  onBillingChange,
  onSameBillingChange,
  onSign,
  onTermsChange,
  onAccept,
}: {
  customerName?: string | null;
  deliveryAddress: AddressInput;
  billingAddress: AddressInput;
  sameBilling: boolean;
  signedName: string;
  termsAccepted: boolean;
  canAccept: boolean;
  isSubmitting: boolean;
  error?: string;
  onDeliveryChange: (address: AddressInput) => void;
  onBillingChange: (address: AddressInput) => void;
  onSameBillingChange: (value: boolean) => void;
  onSign: (name: string) => void;
  onTermsChange: (value: boolean) => void;
  onAccept: () => void;
}) {
  return (
    <section className="rounded-lg border border-black/10 bg-white p-5 md:p-6">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="mt-1 h-5 w-5 text-[#fa31a2]" />
        <div>
          <h2 className="text-2xl font-semibold text-neutral-950">Annahmebereich</h2>
          <p className="mt-1 text-sm leading-6 text-neutral-500">
            Bitte prüfen Sie Ihre Auswahl, ergänzen Sie Adressen und bestätigen Sie das Angebot.
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <AddressForm title="Lieferadresse" value={deliveryAddress} onChange={onDeliveryChange} />
        <div className="space-y-3">
          <label className="flex items-center gap-3 rounded-lg border border-black/10 bg-neutral-50 p-3 text-sm font-semibold text-neutral-700">
            <input
              type="checkbox"
              checked={sameBilling}
              onChange={(event) => onSameBillingChange(event.target.checked)}
              className="h-5 w-5 accent-[#fa31a2]"
            />
            Rechnungsadresse entspricht Lieferadresse
          </label>
          <AddressForm
            title="Rechnungsadresse"
            value={billingAddress}
            onChange={onBillingChange}
            disabled={sameBilling}
          />
        </div>
      </div>

      <div className="mt-5">
        <p className="mb-2 text-sm font-semibold text-neutral-700">Signatur *</p>
        <SignatureBox customerName={customerName} signedName={signedName} onSign={onSign} />
      </div>

      <label className="mt-5 flex items-start gap-3 text-sm leading-6 text-neutral-600">
        <input
          type="checkbox"
          checked={termsAccepted}
          onChange={(event) => onTermsChange(event.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0 accent-[#fa31a2]"
        />
        <span>
          Ich akzeptiere das Angebot und die geltenden Bedingungen. Mir ist bewusst, dass die
          Bestellung nach Annahme auf Basis der ausgewählten Positionen verarbeitet wird.
        </span>
      </label>

      {error ? (
        <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        disabled={!canAccept || isSubmitting}
        onClick={onAccept}
        className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-[#fa31a2] px-5 text-base font-semibold text-white transition hover:bg-[#d9278a] focus:outline-none focus:ring-2 focus:ring-[#fa31a2] focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-neutral-300 md:w-auto"
      >
        {isSubmitting ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
        Angebot annehmen
      </button>
    </section>
  );
}

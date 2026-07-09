"use client";

import { Minus, Plus } from "lucide-react";
import { formatCurrency } from "@/lib/quotes/format";
import type { QuoteItemRecord, QuoteSection } from "@/lib/quotes/types";

export type ItemUiState = Record<string, { selected: boolean; quantity: number }>;

const sectionTitles: Record<QuoteSection, string> = {
  products: "Produktvarianten",
  addons: "Optionale Add-ons",
  shipping: "Versandoptionen",
};

const sectionCopy: Record<QuoteSection, string> = {
  products: "Wählen Sie die Designs aus, die Sie beauftragen möchten.",
  addons: "Ergänzen Sie sinnvolle Optionen für Montage, Steuerung und Versand.",
  shipping: "Standard ist vorausgewählt. Expressoptionen werden nur angezeigt, wenn sie technisch passen.",
};

export function QuoteItemSection({
  section,
  items,
  state,
  currency,
  onToggle,
  onQuantityChange,
}: {
  section: QuoteSection;
  items: QuoteItemRecord[];
  state: ItemUiState;
  currency: string;
  onToggle: (item: QuoteItemRecord, selected: boolean) => void;
  onQuantityChange: (item: QuoteItemRecord, quantity: number) => void;
}) {
  if (!items.length) return null;
  const isShipping = section === "shipping";

  return (
    <section className="rounded-lg border border-black/10 bg-white p-5 md:p-6">
      <div className="mb-5 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-neutral-950">{sectionTitles[section]}</h2>
          <p className="mt-1 text-sm leading-6 text-neutral-500">{sectionCopy[section]}</p>
        </div>
      </div>

      <div className="space-y-3">
        {items.map((item) => {
          const itemState = state[item.id] || {
            selected: item.selected_default,
            quantity: Number(item.quantity),
          };
          const isSingleSelect = isShipping || item.metadata?.selection_mode === "single";
          const inputType = isSingleSelect ? "radio" : "checkbox";
          const inputName = isShipping
            ? "shipping"
            : typeof item.metadata?.selection_group === "string"
              ? item.metadata.selection_group
              : item.section;

          return (
            <article
              key={item.id}
              className={`rounded-lg border p-4 transition ${
                itemState.selected
                  ? "border-[#fa31a2]/45 bg-[#fa31a2]/[0.035]"
                  : "border-black/10 bg-white"
              }`}
            >
              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
                <label className="flex min-w-0 cursor-pointer gap-4">
                  <input
                    type={inputType}
                    name={inputName}
                    checked={itemState.selected}
                    onChange={(event) => onToggle(item, event.target.checked)}
                    className="mt-1 h-5 w-5 shrink-0 accent-[#fa31a2]"
                  />
                  <span className="min-w-0">
                    <span className="block text-base font-semibold text-neutral-950">{item.name}</span>
                    {item.description ? (
                      <span className="mt-2 block whitespace-pre-line text-sm leading-6 text-neutral-600">
                        {item.description}
                      </span>
                    ) : null}
                  </span>
                </label>

                <div className="flex items-center justify-between gap-4 md:justify-end">
                  {item.quantity_editable ? (
                    <div className="flex h-10 items-center rounded-md border border-black/10 bg-white">
                      <button
                        type="button"
                        aria-label="Menge reduzieren"
                        onClick={() => onQuantityChange(item, Math.max(1, itemState.quantity - 1))}
                        className="flex h-10 w-10 items-center justify-center text-neutral-600 hover:text-neutral-950 focus:outline-none focus:ring-2 focus:ring-[#fa31a2]"
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <input
                        aria-label={`Menge fuer ${item.name}`}
                        type="number"
                        min={1}
                        value={itemState.quantity}
                        onChange={(event) =>
                          onQuantityChange(item, Math.max(1, Number(event.target.value) || 1))
                        }
                        className="h-10 w-14 border-x border-black/10 text-center text-sm font-semibold outline-none"
                      />
                      <button
                        type="button"
                        aria-label="Menge erhöhen"
                        onClick={() => onQuantityChange(item, itemState.quantity + 1)}
                        className="flex h-10 w-10 items-center justify-center text-neutral-600 hover:text-neutral-950 focus:outline-none focus:ring-2 focus:ring-[#fa31a2]"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <span className="text-sm font-semibold text-neutral-500">Menge {item.quantity}</span>
                  )}

                  <strong className="min-w-[110px] text-right text-base font-semibold text-neutral-950">
                    {formatCurrency(Number(item.unit_price), currency)}
                  </strong>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

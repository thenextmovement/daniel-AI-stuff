"use client";

import type { AddressInput } from "@/lib/quotes/types";

const fields = [
  ["company", "Firma", false],
  ["first_name", "Vorname", true],
  ["last_name", "Nachname", true],
  ["street", "Straße und Hausnummer", true],
  ["postal_code", "PLZ", true],
  ["city", "Stadt", true],
  ["country", "Land", true],
] as const;

export function emptyAddress(country?: string | null): AddressInput {
  return {
    company: "",
    first_name: "",
    last_name: "",
    street: "",
    postal_code: "",
    city: "",
    country: country || "",
  };
}

export function AddressForm({
  title,
  value,
  onChange,
  disabled = false,
}: {
  title: string;
  value: AddressInput;
  onChange: (value: AddressInput) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="rounded-lg border border-black/10 bg-white p-5">
      <legend className="px-1 text-lg font-semibold text-neutral-950">{title}</legend>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {fields.map(([key, label, required]) => (
          <label key={key} className={key === "street" ? "sm:col-span-2" : ""}>
            <span className="text-sm font-semibold text-neutral-700">
              {label}
              {required ? " *" : ""}
            </span>
            <input
              value={String(value[key] || "")}
              required={required}
              disabled={disabled}
              onChange={(event) => onChange({ ...value, [key]: event.target.value })}
              className="mt-1 h-11 w-full rounded-md border border-black/10 bg-white px-3 text-base text-neutral-950 outline-none transition focus:border-[#fa31a2] focus:ring-2 focus:ring-[#fa31a2]/20 disabled:bg-neutral-100"
            />
          </label>
        ))}
      </div>
    </fieldset>
  );
}

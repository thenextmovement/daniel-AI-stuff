export type ComparisonField = {
  label: string;
  previous: string;
  next: string;
  changed: boolean;
};

const COUNTRY_ALIASES: Record<string, string> = {
  de: "DE",
  deutschland: "DE",
  germany: "DE",
  at: "AT",
  österreich: "AT",
  oesterreich: "AT",
  austria: "AT",
  ch: "CH",
  schweiz: "CH",
  switzerland: "CH",
};

const COUNTRY_LABELS: Record<string, string> = {
  DE: "Deutschland",
  AT: "Österreich",
  CH: "Schweiz",
};

function plainValue(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function normalizedAlias(value: unknown) {
  return plainValue(value).toLocaleLowerCase("de-DE");
}

function firstValue(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && plainValue(source[key])) return source[key];
  }
  return "";
}

function splitName(value: unknown) {
  const parts = plainValue(value).split(/\s+/).filter(Boolean);
  return { firstName: parts.shift() || "", lastName: parts.join(" ") };
}

function addressNames(source: Record<string, unknown>) {
  const fullName = firstValue(source, ["name", "contactName"]);
  const parsed = splitName(fullName);
  return {
    firstName: firstValue(source, ["firstName", "contactFirstName"]) || parsed.firstName,
    lastName: firstValue(source, ["lastName", "contactLastName"]) || parsed.lastName,
  };
}

function countryCode(value: unknown) {
  const normalized = normalizedAlias(value);
  return COUNTRY_ALIASES[normalized] || (normalized.length === 2 ? normalized.toUpperCase() : normalized);
}

function countryLabel(value: unknown) {
  const code = countryCode(value);
  return COUNTRY_LABELS[code] || plainValue(value) || "–";
}

export function comparisonValue(value: unknown) {
  return plainValue(value) || "–";
}

export function comparisonField(label: string, previousValue: unknown, nextValue: unknown): ComparisonField {
  const previousRaw = plainValue(previousValue);
  const nextRaw = plainValue(nextValue);
  return {
    label,
    previous: previousRaw || "–",
    next: nextRaw || "–",
    changed: previousRaw !== nextRaw,
  };
}

export function comparisonFieldChanged(field: ComparisonField) {
  return field.changed;
}

export function addressComparisonFields(previous: Record<string, unknown>, next: Record<string, unknown>, delivery = false): ComparisonField[] {
  const previousNames = addressNames(previous);
  const nextNames = addressNames(next);
  const makeField = (label: string, previousKeys: string[], nextKeys = previousKeys) =>
    comparisonField(label, firstValue(previous, previousKeys), firstValue(next, nextKeys));
  const previousCountry = firstValue(previous, ["country", "countryCode", "country_code"]);
  const nextCountry = firstValue(next, ["country", "countryCode", "country_code"]);
  const fields: ComparisonField[] = [
    makeField(delivery ? "Firma am Lieferort" : "Firma", ["company", "contactCompany"]),
    comparisonField("Vorname", previousNames.firstName, nextNames.firstName),
    comparisonField("Nachname", previousNames.lastName, nextNames.lastName),
    makeField("Straße und Hausnummer", ["street", "address1", "address"]),
    makeField("PLZ", ["zip", "zipCode", "postalCode"]),
    makeField("Ort", ["city"]),
    {
      label: delivery ? "Lieferland" : "Rechnungsland",
      previous: countryLabel(previousCountry),
      next: countryLabel(nextCountry),
      changed: countryCode(previousCountry) !== countryCode(nextCountry),
    },
  ];
  if (delivery) {
    fields.push(makeField("Zusätzliche Lieferhinweise", ["deliveryInstructions", "note"]));
  }
  return fields;
}

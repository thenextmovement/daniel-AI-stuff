export function formatCurrency(value: number, currency = "EUR") {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(value);
}

export function formatDate(value?: string | null) {
  if (!value) return new Intl.DateTimeFormat("de-DE").format(new Date());
  return new Intl.DateTimeFormat("de-DE").format(new Date(value));
}

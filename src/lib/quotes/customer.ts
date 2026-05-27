export function normalizeEmail(email: string) {
  return email.trim().toLowerCase().replace(/\.+$/g, "");
}

export function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));
}

export function buildCustomerName(firstName?: string | null, lastName?: string | null) {
  return [firstName, lastName].map((part) => String(part || "").trim()).filter(Boolean).join(" ");
}

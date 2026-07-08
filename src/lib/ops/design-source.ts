export function isEligibleAiMockupSourceName(name: string | null | undefined) {
  const normalized = String(name || "").trim();
  if (!normalized) return false;
  const lower = normalized.toLowerCase();
  if (lower.includes("alte_") || lower.includes("vorschaubilder")) return false;
  if (!/mockup/i.test(normalized) || !/\bai\b|_ai_|-ai-| ai |ai_/i.test(normalized)) return false;
  return /\.jpe?g(?:$|[?#])/i.test(normalized);
}

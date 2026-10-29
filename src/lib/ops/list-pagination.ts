import { QuoteValidationError } from "@/lib/quotes/validation";

export type OpsListPageOptions = { limit?: number | null; offset?: number | null };

// Offsets enumerate a stable dataset; callers should restart a sweep after concurrent edits.
export function normalizeOpsListPage(input: OpsListPageOptions, defaultLimit: number, maxLimit: number) {
  const limit = input.limit ?? defaultLimit;
  const offset = input.offset ?? 0;
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new QuoteValidationError("limit muss eine positive ganze Zahl sein.", ["invalid_limit"], 422);
  }
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new QuoteValidationError("offset muss eine nichtnegative ganze Zahl sein.", ["invalid_offset"], 422);
  }
  return { limit: Math.min(limit, maxLimit), offset };
}

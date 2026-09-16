import { supabaseRequest } from "@/lib/quotes/supabase-rest";
import { QuoteValidationError } from "@/lib/quotes/validation";

export type VoiceDirectoryContact = {
  customerId: string;
  requestId: string | null;
  displayName: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  requestTitle: string | null;
};
type DirectoryRow = {
  id: string; request_id: string | null; name: string | null;
  first_name: string | null; last_name: string | null;
  company: string | null; company_name: string | null;
  email: string | null; phone: string | null; original_phone: string | null;
  requests?: Array<{ request_id: string | null; title: string | null }>;
};
const PAGE_SIZE = 20;
const text = (value: string | null | undefined) => value?.trim() || null;

export function directoryPhoneDigits(value: string) {
  let digits = value.replace(/^(?:\+|00)49\s*\(0\)/, "49").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  else if (digits.startsWith("0")) digits = "49" + digits.slice(1);
  return digits;
}

// Quote every PostgREST filter value: punctuation must remain data, never operators.
function filterValue(value: string) {
  return '"' + value.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

export async function listVoiceDirectory(query: string, offset = 0) {
  const term = query.trim();
  if (term.length > 160 || !Number.isSafeInteger(offset) || offset < 0 || offset > 100000) {
    throw new QuoteValidationError("Ungültige Kundensuche.", ["invalid_directory_query"], 400);
  }
  if (term.length === 1) return { results: [], nextOffset: null };
  const phoneQuery = /^[+\d\s()./-]+$/.test(term) && term.replace(/\D/g, "").length >= 5;
  const needle = phoneQuery ? directoryPhoneDigits(term) : null;
  let filter: string | undefined;
  if (needle) {
    // Candidate lookup tolerates formatting. Verify the digits after reading so
    // wildcards cannot turn e.g. 123456 into a match for 1293456.
    const national = needle.startsWith("49") ? needle.slice(2) : needle;
    const pattern = filterValue("*" + national.split("").join("*") + "*");
    filter = `(phone.ilike.${pattern},original_phone.ilike.${pattern})`;
  } else if (term) {
    const pattern = filterValue("*" + term.replace(/[%*_]/g, " ").replace(/\s+/g, " ").trim() + "*");
    if (!term.replace(/[%*_\s]/g, "")) return { results: [], nextOffset: null };
    filter = "(" + ["name", "first_name", "last_name", "company", "company_name", "email", "billing_email", "original_email"]
      .map(field => `${field}.ilike.${pattern}`).join(",") + ")";
  }
  const rows = await supabaseRequest<DirectoryRow[]>("master_customers", {
    signal: AbortSignal.timeout(8000),
  }, {
    select: "id,request_id,name,first_name,last_name,company,company_name,email,phone,original_phone,requests:master_requests!requests_customer_id_fkey(request_id,title)",
    "requests.order": "updated_at.desc.nullslast,id.desc",
    "requests.request_id": "not.is.null",
    "requests.limit": 1,
    ...(filter ? { or: filter } : {}),
    order: "name.asc.nullslast,id.asc",
    offset,
    limit: PAGE_SIZE + 1,
  });
  if (!Array.isArray(rows)) throw new Error("Invalid customer directory response");
  const page = rows.slice(0, PAGE_SIZE);
  return {
    results: page.filter(row => !needle || [row.phone, row.original_phone].some(value => value && directoryPhoneDigits(value).includes(needle)))
      .map(row => ({
        customerId: row.id,
        requestId: text(row.requests?.[0]?.request_id) || text(row.request_id),
        displayName: text(row.name) || text([row.first_name, row.last_name].filter(Boolean).join(" ")),
        company: text(row.company) || text(row.company_name),
        email: text(row.email),
        phone: text(row.phone),
        requestTitle: text(row.requests?.[0]?.title),
      })),
    nextOffset: rows.length > PAGE_SIZE ? offset + PAGE_SIZE : null,
  };
}

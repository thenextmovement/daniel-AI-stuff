import { createHash } from "node:crypto";
import {
  SupabaseRestError,
  supabaseRequest,
  supabaseRpc,
} from "@/lib/quotes/supabase-rest";

export const OFFICIAL_INSOLVENCY_SOURCE =
  "https://neu.insolvenzbekanntmachungen.de/ap/suche.jsf";
export const OFFICIAL_INSOLVENCY_SOURCE_LABEL =
  "Insolvenzbekanntmachungen der deutschen Insolvenzgerichte";

export type DunningInsolvencyIdentity = {
  kind: "company" | "person" | "unknown";
  companyName: string | null;
  firstName: string | null;
  lastName: string | null;
  locality: string | null;
  complete: boolean;
};

export type OfficialInsolvencyPublication = {
  publicationDate: string;
  court: string;
  fileNumber: string;
  subjectName: string;
  locality: string;
  register: string | null;
};

export type DunningInsolvencyResultCode =
  | "public_notice_found"
  | "no_public_notice_found"
  | "ambiguous_match"
  | "identity_incomplete"
  | "technical_error";

export type DunningInsolvencyCheck = {
  id: string;
  orderNumber: string;
  eventKey: string;
  identityHash: string;
  identity: DunningInsolvencyIdentity;
  status: "checking" | "completed" | "retryable" | "failed_final";
  resultCode: DunningInsolvencyResultCode | null;
  resultLabel: string;
  sourceUrl: string;
  sourceLabel: string;
  checkedAt: string | null;
  matchCount: number;
  matches: OfficialInsolvencyPublication[];
  attemptCount: number;
  nextAttemptAt: string | null;
  lastErrorCode: string | null;
  createdAt: string;
  updatedAt: string;
};

type DunningInsolvencyCheckRow = {
  id: string;
  order_number: string;
  event_key: string;
  identity_hash: string;
  identity_snapshot: DunningInsolvencyIdentity;
  source: string;
  source_url: string;
  status: DunningInsolvencyCheck["status"];
  result_code: DunningInsolvencyResultCode | null;
  checked_at: string | null;
  match_count: number | null;
  matches: unknown;
  attempt_count: number | null;
  next_attempt_at: string | null;
  last_error_code: string | null;
  created_at: string;
  updated_at: string;
};

type OfficialSearchResult = {
  resultCode:
    | "public_notice_found"
    | "no_public_notice_found"
    | "ambiguous_match";
  matches: OfficialInsolvencyPublication[];
  matchCount: number;
};

type ClaimResult = {
  claimed: boolean;
  id: string;
  status: DunningInsolvencyCheck["status"];
  attempt_count: number;
};

export type DunningInsolvencyScanCandidate = {
  orderNumber: string;
  legalReviewDueAt: string;
  identity: DunningInsolvencyIdentity;
};

export type DunningInsolvencyScanOutcome = {
  orderNumber: string;
  action: "checked" | "recorded_incomplete" | "retry_scheduled" | "skipped";
  resultCode: DunningInsolvencyResultCode | null;
  matchCount: number;
};

function clean(value: unknown, max = 300) {
  const result = String(value ?? "")
    .normalize("NFKC")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return result ? result.slice(0, max) : null;
}

export function buildDunningInsolvencyIdentity(input: {
  companyName?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  locality?: unknown;
}): DunningInsolvencyIdentity {
  const companyName = clean(input.companyName, 180);
  const firstName = clean(input.firstName, 120);
  const lastName = clean(input.lastName, 120);
  const locality = clean(input.locality, 160);
  const kind = companyName
    ? "company"
    : firstName || lastName
      ? "person"
      : "unknown";
  return {
    kind,
    companyName,
    firstName,
    lastName,
    locality,
    complete:
      kind === "company"
        ? Boolean(companyName && locality)
        : kind === "person"
          ? Boolean(firstName && lastName && locality)
          : false,
  };
}

export function dunningInsolvencyIdentityHash(
  identity: DunningInsolvencyIdentity,
) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        kind: identity.kind,
        companyName: identity.companyName,
        firstName: identity.firstName,
        lastName: identity.lastName,
        locality: identity.locality,
      }),
    )
    .digest("hex");
}

export function dunningInsolvencyEventKey(
  candidate: DunningInsolvencyScanCandidate,
) {
  return createHash("sha256")
    .update(
      [
        "neontrip.dunning.insolvency-check.v1",
        candidate.orderNumber,
        candidate.legalReviewDueAt,
        dunningInsolvencyIdentityHash(candidate.identity),
      ].join("|"),
    )
    .digest("hex");
}

export function dunningInsolvencyResultLabel(
  status: DunningInsolvencyCheck["status"],
  resultCode: DunningInsolvencyResultCode | null,
) {
  if (status === "checking") return "Prüfung läuft";
  if (resultCode === "public_notice_found")
    return "Amtliche Veröffentlichung gefunden";
  if (resultCode === "no_public_notice_found")
    return "Kein öffentlicher Insolvenzhinweis gefunden";
  if (resultCode === "ambiguous_match")
    return "Treffer uneindeutig – manuell prüfen";
  if (resultCode === "identity_incomplete")
    return "Schuldnerdaten unvollständig";
  if (status === "retryable") return "Prüfung wird wiederholt";
  if (status === "failed_final") return "Prüfung technisch fehlgeschlagen";
  return "Noch nicht geprüft";
}

function decodeHtml(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
    shy: "",
  };
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (entity, code: string) => {
      if (code.startsWith("#x"))
        return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
      if (code.startsWith("#"))
        return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
      return named[code.toLowerCase()] ?? entity;
    })
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedMatchValue(value: unknown) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("de")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function spanById(html: string, id: string) {
  const escaped = id.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&");
  const match = html.match(
    new RegExp('<span[^>]+id="' + escaped + '"[^>]*>([\\s\\S]*?)<\\/span>', "i"),
  );
  return match ? decodeHtml(match[1]) : null;
}

function rowSpan(html: string, suffix: string) {
  const match = html.match(
    new RegExp(
      '<span[^>]+id="tbl_ergebnis:\\d+:' +
        suffix +
        '"[^>]*>([\\s\\S]*?)<\\/span>',
      "i",
    ),
  );
  return match ? decodeHtml(match[1]) : null;
}

function publicationFromRow(row: string): OfficialInsolvencyPublication | null {
  const publicationDate = rowSpan(row, "otx_datum");
  const fileNumber = rowSpan(row, "otx_azAkt");
  const court = rowSpan(row, "otx_Gericht");
  const subjectName = rowSpan(row, "otx_schuldner");
  const locality = rowSpan(row, "otx_Sitz");
  const register = rowSpan(row, "otx_register");
  if (
    !publicationDate ||
    !fileNumber ||
    !court ||
    !subjectName ||
    !locality
  )
    return null;
  return {
    publicationDate,
    court,
    fileNumber,
    subjectName,
    locality,
    register: register || null,
  };
}

function publicationMatchesIdentity(
  publication: OfficialInsolvencyPublication,
  identity: DunningInsolvencyIdentity,
) {
  if (
    normalizedMatchValue(publication.locality) !==
    normalizedMatchValue(identity.locality)
  )
    return false;
  const subject = normalizedMatchValue(publication.subjectName);
  if (identity.kind === "company")
    return subject === normalizedMatchValue(identity.companyName);
  if (identity.kind !== "person") return false;
  const firstLast = normalizedMatchValue(
    [identity.firstName, identity.lastName].filter(Boolean).join(" "),
  );
  const lastFirst = normalizedMatchValue(
    [identity.lastName, identity.firstName].filter(Boolean).join(" "),
  );
  return subject === firstLast || subject === lastFirst;
}

export function parseOfficialInsolvencySearchResult(
  html: string,
  identity: DunningInsolvencyIdentity,
): OfficialSearchResult {
  if (
    !html.includes("Suchergebnis -") ||
    !html.includes("Veröffentlichungs") ||
    html.length > 5_000_000
  )
    throw new Error("INSOLVENCY_UNEXPECTED_RESULT_PAGE");
  const echoedName = spanById(html, "otx_firmaNachnameValue");
  const echoedLocality = spanById(html, "otx_sitzValue");
  const expectedName =
    identity.kind === "company" ? identity.companyName : identity.lastName;
  if (
    normalizedMatchValue(echoedName) !== normalizedMatchValue(expectedName) ||
    normalizedMatchValue(echoedLocality) !==
      normalizedMatchValue(identity.locality)
  )
    throw new Error("INSOLVENCY_QUERY_ECHO_MISMATCH");
  if (html.includes('id="otx_keineTreffer"'))
    return {
      resultCode: "no_public_notice_found",
      matches: [],
      matchCount: 0,
    };
  const tableBody = html.match(
    /<table[^>]+id="tbl_ergebnis"[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/i,
  )?.[1];
  if (!tableBody) throw new Error("INSOLVENCY_RESULT_TABLE_MISSING");
  const rows = [...tableBody.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((match) => publicationFromRow(match[1]))
    .filter(
      (publication): publication is OfficialInsolvencyPublication =>
        Boolean(publication),
    );
  if (!rows.length) throw new Error("INSOLVENCY_RESULT_ROWS_INVALID");
  const exact = rows.filter((publication) =>
    publicationMatchesIdentity(publication, identity),
  );
  if (!exact.length)
    return {
      resultCode: "ambiguous_match",
      matches: rows.slice(0, 25),
      matchCount: rows.length,
    };
  return {
    resultCode: "public_notice_found",
    matches: exact.slice(0, 50),
    matchCount: exact.length,
  };
}

function officialUrl(value: string) {
  const url = new URL(value, OFFICIAL_INSOLVENCY_SOURCE);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "neu.insolvenzbekanntmachungen.de" ||
    !url.pathname.startsWith("/ap/")
  )
    throw new Error("INSOLVENCY_UNSAFE_REDIRECT");
  return url;
}

function fetchHeaders() {
  return {
    Accept: "text/html,application/xhtml+xml",
    "Accept-Language": "de-DE,de;q=0.9",
    "User-Agent":
      "NEONTRIP-Ops/1.0 (automated individual insolvency-publication check)",
  };
}

function berlinIsoDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value || "";
  return [part("year"), part("month"), part("day")].join("-");
}

async function readOfficialHtml(
  response: Response,
  maxBytes: number,
  sizeErrorCode: string,
) {
  const contentType = String(response.headers.get("content-type") || "")
    .toLowerCase()
    .split(";")[0]
    .trim();
  if (!["text/html", "application/xhtml+xml"].includes(contentType))
    throw new Error("INSOLVENCY_UNEXPECTED_CONTENT_TYPE");
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes)
    throw new Error(sizeErrorCode);
  if (!response.body) throw new Error("INSOLVENCY_EMPTY_RESPONSE");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let html = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    received += chunk.value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      throw new Error(sizeErrorCode);
    }
    html += decoder.decode(chunk.value, { stream: true });
  }
  return html + decoder.decode();
}

export async function lookupOfficialInsolvencyPublications(
  identity: DunningInsolvencyIdentity,
  fetchImpl: typeof fetch = fetch,
): Promise<OfficialSearchResult> {
  if (!identity.complete) throw new Error("INSOLVENCY_IDENTITY_INCOMPLETE");
  const initial = await fetchImpl(OFFICIAL_INSOLVENCY_SOURCE, {
    headers: fetchHeaders(),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  officialUrl(initial.url || OFFICIAL_INSOLVENCY_SOURCE);
  if (!initial.ok) throw new Error("INSOLVENCY_SOURCE_UNAVAILABLE");
  const initialHtml = await readOfficialHtml(
    initial,
    2_000_000,
    "INSOLVENCY_SEARCH_PAGE_TOO_LARGE",
  );
  const formAction = initialHtml.match(
    /<form[^>]+id="frm_suche"[^>]+action="([^"]+)"/i,
  )?.[1];
  const viewStates = [
    ...initialHtml.matchAll(
      /name="jakarta\.faces\.ViewState"[^>]+value="([^"]+)"/gi,
    ),
  ];
  const viewState = viewStates.at(-1)?.[1];
  if (!formAction || !viewState)
    throw new Error("INSOLVENCY_SEARCH_FORM_CHANGED");
  const searchUrl = officialUrl(decodeHtml(formAction));
  const body = new URLSearchParams();
  const set = (key: string, value: string) => body.set(key, value);
  set("frm_suche", "frm_suche");
  set(
    "frm_suche:lsom_bundesland:codelist:scl_bundesland:mysom",
    "NO_CODE",
  );
  set(
    "frm_suche:lsi_insolvenzgerichte:codelist:scl_insolvenzgericht:mysom",
    "NO_CODE",
  );
  set("frm_suche:ldi_datumVon:datumHtml5", "2000-01-01");
  set(
    "frm_suche:ldi_datumBis:datumHtml5",
    berlinIsoDate(),
  );
  set("frm_suche:lsom_wildcard:lsom", "0");
  set(
    "frm_suche:litx_firmaNachName:text",
    identity.kind === "company"
      ? String(identity.companyName)
      : String(identity.lastName),
  );
  set(
    "frm_suche:litx_vorname:text",
    identity.kind === "person" ? String(identity.firstName) : "",
  );
  set("frm_suche:litx_sitzWohnsitz:text", String(identity.locality));
  set("frm_suche:iaz_aktenzeichen:itx_abteilung", "");
  set("frm_suche:iaz_aktenzeichen:som_registerzeichen:mysom", "NO_CODE");
  set("frm_suche:iaz_aktenzeichen:itx_lfdNr", "");
  set("frm_suche:iaz_aktenzeichen:itx_jahr", "");
  set("frm_suche:iaz_aktenzeichen:ih_aktenzeichen", "true");
  set("frm_suche:lsom_gegenstand:codelist:mysom", "NO_CODE");
  set(
    "frm_suche:ir_registereintrag:som_registergericht:mysom",
    "NO_CODE",
  );
  set("frm_suche:ir_registereintrag:som_registerart:mysom", "NO_CODE");
  set("frm_suche:ir_registereintrag:itx_registernummer", "");
  set("frm_suche:ir_registereintrag:ih_registereintrag", "true");
  set("frm_suche:cbt_suchen", "Suchen");
  set("jakarta.faces.ViewState", decodeHtml(viewState));
  const cookie = initial.headers.get("set-cookie")?.split(";")[0];
  const result = await fetchImpl(searchUrl, {
    method: "POST",
    headers: {
      ...fetchHeaders(),
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      Referer: initial.url || OFFICIAL_INSOLVENCY_SOURCE,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  officialUrl(result.url || searchUrl.toString());
  if (!result.ok) throw new Error("INSOLVENCY_SOURCE_UNAVAILABLE");
  const html = await readOfficialHtml(
    result,
    5_000_000,
    "INSOLVENCY_RESULT_PAGE_TOO_LARGE",
  );
  return parseOfficialInsolvencySearchResult(html, identity);
}

function validMatches(value: unknown): OfficialInsolvencyPublication[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (entry): entry is OfficialInsolvencyPublication =>
        Boolean(
          entry &&
            typeof entry === "object" &&
            typeof (entry as OfficialInsolvencyPublication).publicationDate ===
              "string" &&
            typeof (entry as OfficialInsolvencyPublication).court === "string" &&
            typeof (entry as OfficialInsolvencyPublication).fileNumber ===
              "string" &&
            typeof (entry as OfficialInsolvencyPublication).subjectName ===
              "string" &&
            typeof (entry as OfficialInsolvencyPublication).locality === "string",
        ),
    )
    .slice(0, 50);
}

function checkFromRow(row: DunningInsolvencyCheckRow): DunningInsolvencyCheck {
  return {
    id: row.id,
    orderNumber: row.order_number,
    eventKey: row.event_key,
    identityHash: row.identity_hash,
    identity: row.identity_snapshot,
    status: row.status,
    resultCode: row.result_code,
    resultLabel: dunningInsolvencyResultLabel(row.status, row.result_code),
    sourceUrl: row.source_url,
    sourceLabel: OFFICIAL_INSOLVENCY_SOURCE_LABEL,
    checkedAt: row.checked_at,
    matchCount: Number(row.match_count || 0),
    matches: validMatches(row.matches),
    attemptCount: Number(row.attempt_count || 0),
    nextAttemptAt: row.next_attempt_at,
    lastErrorCode: row.last_error_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function loadLatestDunningInsolvencyChecks() {
  try {
    const rows = await supabaseRequest<DunningInsolvencyCheckRow[]>(
      "dunning_insolvency_checks",
      undefined,
      {
        select:
          "id,order_number,event_key,identity_hash,identity_snapshot,source,source_url,status,result_code,checked_at,match_count,matches,attempt_count,next_attempt_at,last_error_code,created_at,updated_at",
        order: "updated_at.desc",
        limit: 5000,
      },
    );
    const latest = new Map<string, DunningInsolvencyCheck>();
    for (const row of rows) {
      if (!latest.has(row.order_number))
        latest.set(row.order_number, checkFromRow(row));
    }
    return latest;
  } catch (error) {
    const details =
      error instanceof SupabaseRestError ? String(error.details || "") : "";
    if (
      error instanceof SupabaseRestError &&
      (error.status === 404 ||
        (details.includes("dunning_insolvency_checks") &&
          (details.includes("does not exist") ||
            details.includes("schema cache"))))
    )
      return new Map<string, DunningInsolvencyCheck>();
    throw error;
  }
}

function safeErrorCode(error: unknown) {
  const raw =
    error instanceof Error && /^INSOLVENCY_[A-Z0-9_]+$/.test(error.message)
      ? error.message
      : error instanceof DOMException && error.name === "TimeoutError"
        ? "INSOLVENCY_TIMEOUT"
        : "INSOLVENCY_TECHNICAL_ERROR";
  return raw.slice(0, 80);
}

async function finishCheck(
  id: string,
  values: {
    status: "completed" | "retryable" | "failed_final";
    resultCode: DunningInsolvencyResultCode;
    matchCount?: number;
    matches?: OfficialInsolvencyPublication[];
    checkedAt?: string | null;
    nextAttemptAt?: string | null;
    lastErrorCode?: string | null;
  },
) {
  await supabaseRequest(
    "dunning_insolvency_checks",
    {
      method: "PATCH",
      body: JSON.stringify({
        status: values.status,
        result_code: values.resultCode,
        match_count: values.matchCount || 0,
        matches: values.matches || [],
        checked_at: values.checkedAt ?? null,
        lease_expires_at: null,
        next_attempt_at: values.nextAttemptAt ?? null,
        last_error_code: values.lastErrorCode ?? null,
        updated_at: new Date().toISOString(),
      }),
      headers: { Prefer: "return=minimal" },
    },
    { id: "eq." + id, status: "eq.checking" },
  );
}

export async function scanDunningInsolvencyCandidate(
  candidate: DunningInsolvencyScanCandidate,
): Promise<DunningInsolvencyScanOutcome> {
  const identityHash = dunningInsolvencyIdentityHash(candidate.identity);
  const eventKey = dunningInsolvencyEventKey(candidate);
  const claimResponse = await supabaseRpc<ClaimResult[]>(
    "claim_dunning_insolvency_check",
    {
      p_order_number: candidate.orderNumber,
      p_event_key: eventKey,
      p_legal_review_due_at: candidate.legalReviewDueAt,
      p_identity_hash: identityHash,
      p_identity_snapshot: candidate.identity,
      p_source_url: OFFICIAL_INSOLVENCY_SOURCE,
    },
  );
  const claim = claimResponse[0];
  if (!claim?.claimed)
    return {
      orderNumber: candidate.orderNumber,
      action: "skipped",
      resultCode: null,
      matchCount: 0,
    };

  if (!candidate.identity.complete) {
    await finishCheck(claim.id, {
      status: "completed",
      resultCode: "identity_incomplete",
      checkedAt: new Date().toISOString(),
    });
    return {
      orderNumber: candidate.orderNumber,
      action: "recorded_incomplete",
      resultCode: "identity_incomplete",
      matchCount: 0,
    };
  }

  try {
    const result = await lookupOfficialInsolvencyPublications(candidate.identity);
    await finishCheck(claim.id, {
      status: "completed",
      resultCode: result.resultCode,
      matchCount: result.matchCount,
      matches: result.matches,
      checkedAt: new Date().toISOString(),
    });
    return {
      orderNumber: candidate.orderNumber,
      action: "checked",
      resultCode: result.resultCode,
      matchCount: result.matchCount,
    };
  } catch (error) {
    const retryable = claim.attempt_count < 3;
    const delayMinutes = claim.attempt_count <= 1 ? 15 : 120;
    const nextAttemptAt = retryable
      ? new Date(Date.now() + delayMinutes * 60_000).toISOString()
      : null;
    await finishCheck(claim.id, {
      status: retryable ? "retryable" : "failed_final",
      resultCode: "technical_error",
      nextAttemptAt,
      lastErrorCode: safeErrorCode(error),
    });
    return {
      orderNumber: candidate.orderNumber,
      action: retryable ? "retry_scheduled" : "checked",
      resultCode: "technical_error",
      matchCount: 0,
    };
  }
}

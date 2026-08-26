import { NextRequest, NextResponse } from "next/server";
import {
  hasOpsSession,
  isOpsPortalBypassed,
  isOpsPortalConfigured,
  resolveOpsRequestActor,
} from "@/lib/ops/auth";
import {
  getDunningCaseDetail,
  normalizeDunningOrderNumber,
} from "@/lib/ops/dunning";
import {
  saveDunningCourtProfile,
  type DunningCourtRepresentative,
} from "@/lib/ops/dunning-court";

export const dynamic = "force-dynamic";

const REPRESENTATIVE_FUNCTIONS = new Set<
  DunningCourtRepresentative["function"]
>([
  "Geschäftsführende Gesellschafterin",
  "Geschäftsführender Gesellschafter",
  "Geschäftsführer",
  "Geschäftsführerin",
  "Managing Director",
]);

const LEGAL_FORMS = new Set([
  "AG",
  "eG",
  "GmbH",
  "GmbH & Co KG",
  "GmbH & Co OHG",
  "KG",
  "OHG",
  "Partnerschaft",
  "Partnerschaft mbB",
  "SE",
  "UG (haftungsbeschränkt)",
]);

type ProfileBody = {
  action: "verify_profile";
  legalName: string;
  legalForm: string;
  street: string;
  postalCode: string;
  city: string;
  representatives: DunningCourtRepresentative[];
  registerCourt: string;
  registerType: "HRB" | "HRA" | "GnR" | "PR" | "VR";
  registerNumber: string;
  sourceUrl: string;
  communicationReviewed: true;
};

function sameOrigin(request: NextRequest, host: string | null) {
  if (isOpsPortalBypassed(host)) return true;
  const origin = request.headers.get("origin");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

function text(value: unknown, max: number) {
  const result = String(value ?? "")
    .normalize("NFKC")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return result && result.length <= max ? result : null;
}

function officialRegisterUrl(value: unknown) {
  try {
    const url = new URL(String(value || ""));
    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      ![
        "unternehmensregister.de",
        "www.unternehmensregister.de",
        "handelsregister.de",
        "www.handelsregister.de",
      ].includes(host)
    )
      return null;
    return url.toString().slice(0, 1000);
  } catch {
    return null;
  }
}

function parseDunningCourtProfileBody(value: unknown): ProfileBody | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const allowed = new Set([
    "action",
    "legalName",
    "legalForm",
    "street",
    "postalCode",
    "city",
    "representatives",
    "registerCourt",
    "registerType",
    "registerNumber",
    "sourceUrl",
    "communicationReviewed",
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key))) return null;
  const legalName = text(input.legalName, 140);
  const legalForm = text(input.legalForm, 60);
  const street = text(input.street, 140);
  const postalCode = text(input.postalCode, 5);
  const city = text(input.city, 100);
  const registerCourt = text(input.registerCourt, 120);
  const registerType = text(input.registerType, 3);
  const registerNumber = text(input.registerNumber, 40);
  const sourceUrl = officialRegisterUrl(input.sourceUrl);
  if (
    input.action !== "verify_profile" ||
    !legalName ||
    !legalForm ||
    !LEGAL_FORMS.has(legalForm) ||
    !street ||
    !postalCode ||
    !/^[0-9]{5}$/.test(postalCode) ||
    !city ||
    !registerCourt ||
    !registerType ||
    !["HRB", "HRA", "GnR", "PR", "VR"].includes(registerType) ||
    !registerNumber ||
    !sourceUrl ||
    input.communicationReviewed !== true
  )
    return null;
  if (
    legalName.toLocaleLowerCase("de-DE").endsWith(
      legalForm.toLocaleLowerCase("de-DE"),
    )
  )
    return null;
  if (
    !Array.isArray(input.representatives) ||
    input.representatives.length < 1 ||
    input.representatives.length > 6
  )
    return null;
  const representatives: DunningCourtRepresentative[] = [];
  for (const raw of input.representatives) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const row = raw as Record<string, unknown>;
    if (Object.keys(row).some((key) => !["function", "name"].includes(key)))
      return null;
    const representativeFunction = text(
      row.function,
      50,
    ) as DunningCourtRepresentative["function"] | null;
    const name = text(row.name, 140);
    if (
      !representativeFunction ||
      !REPRESENTATIVE_FUNCTIONS.has(representativeFunction) ||
      !name
    )
      return null;
    representatives.push({ function: representativeFunction, name });
  }
  return {
    action: "verify_profile",
    legalName,
    legalForm,
    street,
    postalCode,
    city,
    representatives,
    registerCourt,
    registerType: registerType as ProfileBody["registerType"],
    registerNumber,
    sourceUrl,
    communicationReviewed: true,
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orderKey: string }> },
) {
  const host =
    request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (!isOpsPortalConfigured(host))
    return NextResponse.json(
      { ok: false, error: "ops_not_configured" },
      { status: 503 },
    );
  if (
    !isOpsPortalBypassed(host) &&
    !(await hasOpsSession(host, request.headers))
  )
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  if (!sameOrigin(request, host))
    return NextResponse.json(
      { ok: false, error: "invalid_origin" },
      { status: 403 },
    );
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    return NextResponse.json(
      { ok: false, error: "content_type_required" },
      { status: 415 },
    );
  if (Number(request.headers.get("content-length") || 0) > 8192)
    return NextResponse.json(
      { ok: false, error: "payload_too_large" },
      { status: 413 },
    );
  const { orderKey } = await params;
  const orderNumber = normalizeDunningOrderNumber(orderKey);
  if (!orderNumber)
    return NextResponse.json(
      { ok: false, error: "invalid_order_key" },
      { status: 400 },
    );
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > 8192)
    return NextResponse.json(
      { ok: false, error: "payload_too_large" },
      { status: 413 },
    );
  let json: unknown = null;
  try {
    json = JSON.parse(rawBody);
  } catch {
    json = null;
  }
  const body = parseDunningCourtProfileBody(json);
  if (!body)
    return NextResponse.json(
      { ok: false, error: "invalid_court_profile" },
      { status: 422 },
    );
  const actor = await resolveOpsRequestActor(host, request.headers);
  if (!actor)
    return NextResponse.json(
      { ok: false, error: "personal_login_required" },
      { status: 403 },
    );
  try {
    const detail = await getDunningCaseDetail(orderNumber);
    if (!detail)
      return NextResponse.json(
        { ok: false, error: "dunning_case_not_found" },
        { status: 404 },
      );
    if (!detail.case.courtReview || detail.case.courtEvent)
      return NextResponse.json(
        { ok: false, error: "court_profile_not_available" },
        { status: 409 },
      );
    const now = new Date().toISOString();
    const profile = await saveDunningCourtProfile({
      orderNumber,
      debtorType: "company",
      legalName: body.legalName,
      legalForm: body.legalForm,
      street: body.street,
      postalCode: body.postalCode,
      city: body.city,
      countryCode: "DE",
      representatives: body.representatives,
      registerCourt: body.registerCourt,
      registerType: body.registerType,
      registerNumber: body.registerNumber,
      sourceUrl: body.sourceUrl,
      sourceCheckedAt: now,
      communicationCheckedAt: now,
      verifiedAt: now,
      verifiedBy: actor,
    });
    return NextResponse.json({ ok: true, profile });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "DUNNING_COURT_PROFILE_FAILED";
    const expected = /^DUNNING_COURT_[A-Z0-9_]+$/.test(message);
    console.error("dunning court profile failed", {
      orderNumber,
      message: expected ? message : "unexpected",
    });
    return NextResponse.json(
      { ok: false, error: expected ? message : "court_profile_failed" },
      { status: expected ? 502 : 500 },
    );
  }
}

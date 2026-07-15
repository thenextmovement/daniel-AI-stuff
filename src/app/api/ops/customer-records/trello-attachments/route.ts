import { NextRequest, NextResponse } from "next/server";
import { hasOpsSession, isOpsPortalBypassed, isOpsPortalConfigured } from "@/lib/ops/auth";
import { downloadTrelloAttachment, getTrelloAttachment } from "@/lib/quotes/trello";
import { QuoteValidationError } from "@/lib/quotes/validation";

export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
}

function notConfigured() {
  return NextResponse.json({ ok: false, error: "ops_not_configured" }, { status: 503 });
}

function failureResponse(error: unknown) {
  if (error instanceof QuoteValidationError) {
    return NextResponse.json(
      { ok: false, error: error.message, issues: error.issues },
      { status: error.status },
    );
  }

  console.error("ops trello-attachments route failed", error);
  return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
}

function getOpsHost(request: NextRequest) {
  return request.headers.get("x-forwarded-host") || request.headers.get("host");
}

function assertTrelloId(value: string, fieldName: string) {
  if (!/^[0-9a-f]{24}$/i.test(value)) {
    throw new QuoteValidationError(`${fieldName} ist ungültig.`);
  }
}

export async function GET(request: NextRequest) {
  const host = getOpsHost(request);
  if (!isOpsPortalConfigured(host)) return notConfigured();
  if (!isOpsPortalBypassed(host) && !(await hasOpsSession(host, request.headers))) return unauthorized();

  try {
    const cardId = String(request.nextUrl.searchParams.get("cardId") || "").trim();
    const attachmentId = String(request.nextUrl.searchParams.get("attachmentId") || "").trim();

    if (!cardId || !attachmentId) {
      throw new QuoteValidationError("cardId und attachmentId sind erforderlich.");
    }
    assertTrelloId(cardId, "cardId");
    assertTrelloId(attachmentId, "attachmentId");

    const attachment = await getTrelloAttachment(cardId, attachmentId);
    const thumbnail = request.nextUrl.searchParams.get("thumbnail") === "1";
    const preview = thumbnail
      ? [...(attachment.previews || [])]
          .filter((candidate) => candidate.url && Number(candidate.width || 0) >= 300)
          .sort((left, right) => Number(left.width || 0) - Number(right.width || 0))[0] || null
      : null;
    const file = await downloadTrelloAttachment(preview?.url ? { ...attachment, url: preview.url } : attachment);
    const filename = String(attachment.name || attachment.fileName || attachment.id).replace(/"/g, "");

    return new NextResponse(file.body, {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "private, max-age=86400, stale-while-revalidate=604800",
        "Vary": "Cookie, Cf-Access-Jwt-Assertion",
      },
    });
  } catch (error) {
    return failureResponse(error);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { createQuoteFromTrello } from "@/lib/quotes/create-quote-from-trello";
import { QuoteValidationError } from "@/lib/quotes/validation";

export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
}

function isAuthorized(request: NextRequest) {
  const expected = process.env.QUOTE_INTERNAL_API_TOKEN;
  if (!expected) return false;
  const header = request.headers.get("authorization") || "";
  return header === `Bearer ${expected}`;
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) return unauthorized();

  try {
    const body = (await request.json()) as { cardId?: string; force_new?: boolean; size_ladder_mode?: string | null };
    const result = await createQuoteFromTrello(String(body.cardId || ""), {
      forceNew: body.force_new === true,
      sizeLadderMode: body.size_ladder_mode,
    });

    return NextResponse.json({
      ok: true,
      quote_id: result.quote.id,
      quote_url: result.quote_url,
      share_token: result.quote.share_token,
      reused_existing: result.reused_existing,
      size_ladder: result.size_ladder,
    });
  } catch (error) {
    if (error instanceof QuoteValidationError) {
      return NextResponse.json(
        { ok: false, error: error.message, issues: error.issues },
        { status: error.status },
      );
    }

    console.error("create quote from trello failed", error);
    return NextResponse.json({ ok: false, error: "quote_creation_failed" }, { status: 500 });
  }
}

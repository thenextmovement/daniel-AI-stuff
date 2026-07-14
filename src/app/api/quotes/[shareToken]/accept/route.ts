import { NextRequest, NextResponse } from "next/server";
import { acceptQuote } from "@/lib/quotes/accept-quote";
import { QuoteValidationError } from "@/lib/quotes/validation";
import type { AcceptQuotePayload } from "@/lib/quotes/types";

export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ shareToken: string }>;
};

function clientIp(request: NextRequest) {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    null
  );
}

export async function POST(request: NextRequest, { params }: Params) {
  const { shareToken } = await params;

  try {
    const payload = (await request.json()) as AcceptQuotePayload;
    const result = await acceptQuote({
      shareToken,
      payload,
      ipAddress: clientIp(request),
      userAgent: request.headers.get("user-agent"),
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof QuoteValidationError) {
      return NextResponse.json(
        { ok: false, error: error.message, issues: error.issues },
        { status: error.status },
      );
    }

    console.error("accept quote failed", error);
    return NextResponse.json({ ok: false, error: "quote_acceptance_failed" }, { status: 500 });
  }
}

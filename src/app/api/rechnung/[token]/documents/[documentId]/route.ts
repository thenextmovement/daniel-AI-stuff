import { NextRequest, NextResponse } from "next/server";
import { getBillingPortalDocument } from "@/lib/ops/billing/repository";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, private", "X-Robots-Tag": "noindex, nofollow" };

export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string; documentId: string }> }) {
  const { token, documentId } = await params;
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(token) || !/^[0-9a-f-]{36}$/i.test(documentId)) return new NextResponse(null, { status: 404, headers: NO_STORE });
  const document = await getBillingPortalDocument(token, documentId).catch(() => null);
  if (!document) return new NextResponse(null, { status: 404, headers: NO_STORE });
  const apiKey = String(process.env.EASYBILL_API_KEY || "").trim();
  if (apiKey.length < 20) return NextResponse.json({ ok: false, error: "document_download_not_configured" }, { status: 503, headers: NO_STORE });
  try {
    const response = await fetch(`https://api.easybill.de/rest/v1/documents/${encodeURIComponent(document.easybill_document_id!)}/pdf`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/pdf" },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`easybill_pdf_${response.status}`);
    const pdf = await response.arrayBuffer();
    return new NextResponse(pdf, {
      headers: {
        ...NO_STORE,
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${document.document_number.replace(/[^A-Za-z0-9._-]/g, "-")}.pdf"`,
        "Content-Security-Policy": "default-src 'none'; frame-ancestors 'self'",
      },
    });
  } catch (error) {
    console.error("billing portal document download failed", { documentId, message: error instanceof Error ? error.message : error });
    return NextResponse.json({ ok: false, error: "document_download_failed" }, { status: 502, headers: NO_STORE });
  }
}

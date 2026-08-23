import { NextRequest, NextResponse } from "next/server";
import { getBillingPortal } from "@/lib/ops/billing/repository";
import { validateVatIdWithVies, VatValidationError } from "@/lib/ops/billing/vies";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, private", "X-Robots-Tag": "noindex, nofollow" };

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(token)) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404, headers: NO_STORE });
  const portal = await getBillingPortal(token).catch(() => null);
  if (!portal) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404, headers: NO_STORE });
  if (portal.readOnly) return NextResponse.json({ ok: false, error: "invoice_already_created" }, { status: 409, headers: NO_STORE });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  try {
    const validation = await validateVatIdWithVies({
      deliveryCountry: body?.deliveryCountry || portal.billingCase.delivery_address?.country,
      vatId: body?.vatId,
      company: body?.company,
    });
    return NextResponse.json({ ok: validation.valid, validation, error: validation.valid ? null : "vat_id_invalid" }, { status: validation.valid ? 200 : 422, headers: NO_STORE });
  } catch (error) {
    const code = error instanceof VatValidationError ? error.code : "vat_validation_unavailable";
    return NextResponse.json({ ok: false, error: code }, { status: code === "vat_validation_unavailable" ? 503 : 422, headers: NO_STORE });
  }
}

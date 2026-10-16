import { isBillingWorkerAuthorized } from "@/lib/ops/billing/internal-auth";
import { readJson, NO_CACHE } from "@/lib/ops/x-measurement/http";
import { handleXWorker } from "@/lib/ops/x-measurement/repository";
export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!isBillingWorkerAuthorized(request.headers)) return new Response(null, { status: 401, headers: NO_CACHE });
  let input;
  try { input = await readJson(request, 2_000_000) as Record<string, unknown>; } catch { return new Response(null, { status: 400, headers: NO_CACHE }); }
  try { return Response.json(await handleXWorker(input), { headers: NO_CACHE }); }
  catch { return Response.json({ ok: false }, { status: 503, headers: NO_CACHE }); }
}

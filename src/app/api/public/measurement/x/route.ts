import { supabaseRpc } from "@/lib/quotes/supabase-rest";
import { captureInput } from "@/lib/ops/x-measurement/validation";
import { cors, readJson, NO_CACHE } from "@/lib/ops/x-measurement/http";
export const runtime = "nodejs";
export async function OPTIONS(request: Request) {
  const headers = cors(request);
  return new Response(null, { status: headers ? 204 : 403, headers: headers || NO_CACHE });
}
export async function POST(request: Request) {
  const headers = cors(request);
  if (!headers) return new Response(null, { status: 403, headers: NO_CACHE });
  let args;
  try { args = captureInput(await readJson(request)); } catch { return new Response(null, { status: 400, headers }); }
  try {
    await supabaseRpc("x_ads_capture", args);
    // Do not reveal whether an order or checkout exists.
    return new Response(null, { status: 204, headers });
  } catch { return new Response(null, { status: 503, headers }); }
}

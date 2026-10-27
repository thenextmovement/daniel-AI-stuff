import { opsRequest } from "./ops-catalog.js";
import type { GatewayConfig } from "./config.js";
import { GatewayError } from "./errors.js";
import type { JsonValue, ServiceName } from "./types.js";

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  binary?: boolean;
  body?: JsonValue;
};

type FetchLike = typeof fetch;

function joinUrl(base: URL, path: string) {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
    throw new GatewayError("invalid_upstream_path", "Interner Zielpfad ist ungültig.");
  }
  const url = new URL(path, base);
  if (url.origin !== base.origin) {
    throw new GatewayError("upstream_origin_blocked", "Ein nicht freigegebenes Ziel wurde blockiert.", 403);
  }
  return url;
}

export class NeontripApi {
  constructor(private readonly config: GatewayConfig, private readonly fetchImpl: FetchLike = fetch) {}

  async nativeOffers(token: string, method: "tools/list" | "tools/call", params: Record<string, unknown>) {
    if (!this.config.offers) throw new GatewayError("offers_not_configured", "Angebotssoftware ist nicht verbunden.", 503);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(this.config.requestTimeoutMs, 30_000));
    try {
      const response = await this.fetchImpl(joinUrl(this.config.offers.baseUrl, "/api/mcp"), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
        body: JSON.stringify({jsonrpc:"2.0",id:1,method,params}),
        redirect:"error", signal:controller.signal,
      });
      if (!response.ok) throw new GatewayError("native_offers_denied", `Die Angebotssoftware hat den persönlichen MCP-Zugang abgelehnt (${response.status}).`,response.status);
      if (!(response.headers.get("content-type") || "").includes("application/json")) throw new GatewayError("invalid_native_response","Ungültiges Antwortformat der Angebotssoftware.",502);
      const maxBytes=32*1024*1024;
      if (Number(response.headers.get("content-length"))>maxBytes) throw new GatewayError("native_response_too_large","Angebotsantwort ist zu groß.",502);
      const bytes=new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength>maxBytes) throw new GatewayError("native_response_too_large","Angebotsantwort ist zu groß.",502);
      const payload=JSON.parse(new TextDecoder().decode(bytes));
      if (!payload || payload.jsonrpc!=="2.0" || payload.error || !payload.result || typeof payload.result!=="object") throw new GatewayError("native_offers_protocol_error","Die Angebotssoftware hat den MCP-Aufruf nicht bestätigt.",502);
      return payload.result as Record<string,unknown>;
    } catch(error) {
      if(error instanceof GatewayError) throw error;
      throw new GatewayError("native_offers_unavailable","Der persönliche Angebotszugang antwortet nicht gültig. Ausführung nicht bestätigt; Schreibaktionen nicht blind wiederholen.",503,true);
    } finally { clearTimeout(timeout); }
  }

  configured(service: ServiceName) {
    return service !== "offers" ? Boolean(this.config.ops) : Boolean(this.config.offers);
  }

  private async request(service: ServiceName, path: string, options: RequestOptions = {}) {
    const target = service !== "offers" ? this.config.ops : this.config.offers;
    if (!target) {
      throw new GatewayError(`${service}_not_configured`, `${service} ist für diesen Gateway noch nicht verbunden.`, 503, false);
    }
    const url = joinUrl(target.baseUrl, path);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    try {
      const headers: Record<string, string> = { Accept: "application/json" };
      if (service !== "offers" && this.config.ops) {
        headers["CF-Access-Client-Id"] = this.config.ops.accessClientId;
        headers["CF-Access-Client-Secret"] = this.config.ops.accessClientSecret;
        headers.Origin = this.config.ops.baseUrl.origin;
      }
      if (service === "offers" && this.config.offers) {
        headers.Authorization = `Bearer ${this.config.offers.apiKey}`;
      }
      if (options.body !== undefined) headers["Content-Type"] = "application/json";
      const response = await this.fetchImpl(url, {
        method: options.method || "GET",
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        redirect: "error",
        signal: controller.signal,
      });
      const mediaType = String(response.headers.get("content-type") || "").split(";", 1)[0]?.trim().toLowerCase();
      if (options.binary && response.ok && ["application/pdf","image/jpeg","image/png","image/webp","image/avif"].includes(mediaType || "")) {
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength > 24*1024*1024) throw new GatewayError("asset_too_large","Datei ist zu groß.",502);
        return { mimeType: mediaType, base64: Buffer.from(bytes).toString("base64") };
      }
      if (mediaType !== "application/json" && !mediaType?.endsWith("+json")) {
        throw new GatewayError("invalid_upstream_content_type", "Das Zielsystem hat keine JSON-Antwort geliefert.", 502, true);
      }
      const length = Number(response.headers.get("content-length") || 0);
      if (length > this.config.maxResponseBytes) {
        throw new GatewayError("upstream_response_too_large", "Die Antwort des Zielsystems war zu groß.", 502);
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > this.config.maxResponseBytes) {
        throw new GatewayError("upstream_response_too_large", "Die Antwort des Zielsystems war zu groß.", 502);
      }
      let payload: unknown;
      try {
        payload = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        throw new GatewayError("invalid_upstream_response", "Das Zielsystem hat keine gültige JSON-Antwort geliefert.", 502, true);
      }
      if (!response.ok) {
        const record = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
        const candidateCode = typeof record.error === "string" ? record.error : "";
        const upstreamCode = /^[A-Za-z0-9:_-]{1,100}$/.test(candidateCode) ? candidateCode : "upstream_error";
        const retryable = response.status === 429 || response.status >= 500;
        throw new GatewayError(upstreamCode, `Das Zielsystem hat die Aktion abgelehnt (${response.status}).`, response.status, retryable);
      }
      return payload;
    } catch (error) {
      if (error instanceof GatewayError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new GatewayError("upstream_timeout", "Das Zielsystem hat nicht rechtzeitig geantwortet.", 504, true);
      }
      throw new GatewayError("upstream_unavailable", "Das Zielsystem ist derzeit nicht erreichbar.", 503, true);
    } finally {
      clearTimeout(timeout);
    }
  }

  async opsOperation(id: string, pathParameters: Record<string,string>, query: Record<string,string|number|boolean>, body?: JsonValue) {
    const {operation,path}=opsRequest(id,pathParameters,query);
    const result=await this.request("customers",path,{method:operation.method as RequestOptions["method"],body:operation.method==="GET"?undefined:body,binary:true});
    if (result && typeof result==="object" && !Array.isArray(result) && "ok" in result && result.ok===false) {
      const candidate="error" in result && typeof result.error==="string" ? result.error : "";
      const code=/^[A-Za-z0-9:_-]{1,100}$/.test(candidate)?candidate:"ops_action_failed";
      throw new GatewayError(code,"OPS hat die Aktion nicht bestätigt: "+code,422,false);
    }
    return result;
  }

  searchCustomers(query: string) {
    return this.request("customers", "/api/ops/voice-copilot/context?query=" + encodeURIComponent(query));
  }
  async customerHistory(requestId: string, offset: number) {
    const [context, history] = await Promise.all([
      this.request("customers", "/api/ops/voice-copilot/context?requestId=" + encodeURIComponent(requestId)),
      this.request("customers", "/api/ops/voice-copilot/transcript?requestId=" + encodeURIComponent(requestId) + "&offset=" + offset),
    ]);
    return { context, history, sourceType: "customer_communication_evidence", testsExcluded: true };
  }
  customerTranscript(sessionId: string, offset: number) {
    return this.request("customers", "/api/ops/voice-copilot/transcript?sessionId=" + encodeURIComponent(sessionId) + "&offset=" + offset);
  }

  listBillingCases(input: { status?: string; query?: string; limit: number }) {
    const params = new URLSearchParams({ limit: String(input.limit) });
    if (input.status) params.set("status", input.status);
    if (input.query) params.set("query", input.query);
    return this.request("billing", `/api/ops/billing?${params.toString()}`);
  }

  getBillingCase(caseId: string) {
    return this.request("billing", `/api/ops/billing/${encodeURIComponent(caseId)}`);
  }

  billingAction(caseId: string, input: { action: string; idempotencyKey: string; payload: JsonValue }) {
    return this.request("billing", `/api/ops/billing/${encodeURIComponent(caseId)}/actions`, { method: "POST", body: input });
  }

  searchOffers(query: string, limit: number) {
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    return this.request("offers", `/api/internal/offers/search?${params.toString()}`);
  }

  listOffers(input: Record<string, string | number | undefined>) {
    const params = new URLSearchParams();
    for (const [key,value] of Object.entries(input)) if (value !== undefined) params.set(key,String(value));
    return this.request("offers", `/api/internal/offers/list?${params.toString()}`);
  }

  listOfferDeliveries(input: Record<string, string | number | undefined>) {
    const params = new URLSearchParams();
    for (const [key,value] of Object.entries(input)) if (value !== undefined) params.set(key,String(value));
    return this.request("offers", `/api/internal/offers/deliveries?${params.toString()}`);
  }

  getOffer(offerId: string) {
    return this.request("offers", `/api/internal/offers/${encodeURIComponent(offerId)}`);
  }

  patchOffer(offerId: string, input: JsonValue, dryRun: boolean) {
    return this.request("offers", `/api/internal/offers/${encodeURIComponent(offerId)}${dryRun ? "?dryRun=true" : ""}`, { method: "PATCH", body: input });
  }

  sendOffer(offerId: string, input: JsonValue) {
    return this.request("offers", `/api/internal/offers/${encodeURIComponent(offerId)}/send`, { method: "POST", body: input });
  }
}

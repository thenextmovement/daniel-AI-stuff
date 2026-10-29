import { opsRequest } from "./ops-catalog.js";
import type { GatewayConfig } from "./config.js";
import { GatewayError } from "./errors.js";
import type { JsonValue, ServiceName } from "./types.js";

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  binary?: boolean;
  attachment?: boolean;
  timeoutMs?: number;
  body?: JsonValue;
};

type FetchLike = typeof fetch;

async function boundedBytes(response: Response, limit: number, failure: GatewayError) {
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel();
    throw failure;
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw failure;
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return new Uint8Array(Buffer.concat(chunks, size));
}

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
    const timeout = setTimeout(() => controller.abort(), method === "tools/call" ? 600_000 : Math.max(this.config.requestTimeoutMs, 30_000));
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
      const bytes=await boundedBytes(response,maxBytes,new GatewayError("native_response_too_large","Angebotsantwort ist zu groß.",502));
      const payload=JSON.parse(new TextDecoder().decode(bytes));
      if (!payload || payload.jsonrpc!=="2.0" || payload.id!==1 || payload.error || !payload.result || typeof payload.result!=="object") throw new GatewayError("native_offers_protocol_error","Die Angebotssoftware hat den MCP-Aufruf nicht bestätigt.",502);
      return payload.result as Record<string,unknown>;
    } catch(error) {
      if(error instanceof GatewayError) throw error;
      throw new GatewayError("native_offers_unavailable","Der persönliche Angebotszugang antwortet nicht gültig. Ausführung nicht bestätigt; Schreibaktionen nicht blind wiederholen.",503,true);
    } finally { clearTimeout(timeout); }
  }

  async notifyWriteFailure(notice: {tool:string;actionId:string;code:string}) {
    if (!this.config.offers) return {status:"not_configured",deliveryConfirmed:false};
    try {
      const value=await this.request("offers","/api/internal/mcp-alerts",{method:"POST",body:notice,timeoutMs:35_000});
      const record=value && typeof value==="object" ? value as Record<string,unknown> : {};
      const notification=record.failureNotification as Record<string,unknown> | undefined;
      if (record.ok===true && notification && ["provider_accepted","failed","unknown","not_configured"].includes(String(notification.status)) && notification.deliveryConfirmed===false) {
        return {status:String(notification.status),deliveryConfirmed:false};
      }
    } catch { /* The original business failure remains authoritative. */ }
    return {status:"unknown",deliveryConfirmed:false};
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
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? this.config.requestTimeoutMs);
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
      // Only the known authenticated attachment route may return arbitrary files.
      // Its disposition header distinguishes files from an upstream login page.
      if (options.attachment && response.ok && response.headers.has("content-disposition")
          && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mediaType || "")) {
        const bytes = await boundedBytes(response,24*1024*1024,new GatewayError("asset_too_large","Datei ist zu groß.",502));
        const safeMime = ["text/html","application/xhtml+xml","image/svg+xml"].includes(mediaType!)
          ? "application/octet-stream" : mediaType!;
        return { binaryAsset:true, mimeType:safeMime, originalMimeType:mediaType, base64:Buffer.from(bytes).toString("base64") };
      }
      if (options.binary && response.ok && ["application/pdf","image/jpeg","image/png","image/webp","image/avif"].includes(mediaType || "")) {
        const bytes = await boundedBytes(response,24*1024*1024,new GatewayError("asset_too_large","Datei ist zu groß.",502));
        return { mimeType: mediaType, base64: Buffer.from(bytes).toString("base64") };
      }
      if (mediaType !== "application/json" && !mediaType?.endsWith("+json")) {
        throw new GatewayError("invalid_upstream_content_type", "Das Zielsystem hat keine JSON-Antwort geliefert.", 502, true);
      }
      const bytes = await boundedBytes(response,this.config.maxResponseBytes,new GatewayError("upstream_response_too_large", "Die Antwort des Zielsystems war zu groß.", 502));
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
    const result=await this.request("customers",path,{method:operation.method as RequestOptions["method"],body:operation.method==="GET"?undefined:body,binary:true,attachment:id==="customer_records_trello_attachments_get",timeoutMs:operation.readOnly?30_000:210_000});
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

  listBillingCases(input: { status?: string; query?: string; limit: number; offset?: number }) {
    const params = new URLSearchParams({ limit: String(input.limit) });
    if (input.status) params.set("status", input.status);
    if (input.query) params.set("query", input.query);
    if (input.offset !== undefined) params.set("offset", String(input.offset));
    return this.request("billing", `/api/ops/billing?${params.toString()}`);
  }

  getBillingCase(caseId: string, input: { eventLimit?: number; eventOffset?: number } = {}) {
    const params = new URLSearchParams();
    if (input.eventLimit !== undefined) params.set("eventLimit", String(input.eventLimit));
    if (input.eventOffset !== undefined) params.set("eventOffset", String(input.eventOffset));
    const query = params.size ? `?${params}` : "";
    return this.request("billing", `/api/ops/billing/${encodeURIComponent(caseId)}${query}`);
  }

  listBillingCaseRecords(caseId: string, input: { collection: string; limit: number; offset: number }) {
    const params = new URLSearchParams({ collection: input.collection, limit: String(input.limit), offset: String(input.offset) });
    return this.request("billing", `/api/ops/billing/${encodeURIComponent(caseId)}?${params}`);
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

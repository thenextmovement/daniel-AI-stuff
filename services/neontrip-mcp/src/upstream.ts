import type { GatewayConfig } from "./config.js";
import { GatewayError } from "./errors.js";
import type { JsonValue, ServiceName } from "./types.js";

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH";
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

  configured(service: ServiceName) {
    return service === "billing" ? Boolean(this.config.ops) : Boolean(this.config.offers);
  }

  private async request(service: ServiceName, path: string, options: RequestOptions = {}) {
    const target = service === "billing" ? this.config.ops : this.config.offers;
    if (!target) {
      throw new GatewayError(`${service}_not_configured`, `${service} ist für diesen Gateway noch nicht verbunden.`, 503, false);
    }
    const url = joinUrl(target.baseUrl, path);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    try {
      const headers: Record<string, string> = { Accept: "application/json" };
      if (service === "billing" && this.config.ops) {
        headers["CF-Access-Client-Id"] = this.config.ops.accessClientId;
        headers["CF-Access-Client-Secret"] = this.config.ops.accessClientSecret;
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

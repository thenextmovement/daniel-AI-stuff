import type { RuntimeConfig } from "./config.js";
import type { RecoveredRuntimeSession, RuntimeSession, StructuredOutcome } from "./types.js";

class OpsRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

export class OpsClient {
  constructor(private readonly config: RuntimeConfig) {}

  private async request<T>(path: string, init: RequestInit = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(`${this.config.opsBaseUrl}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${this.config.opsToken}`,
          "content-type": "application/json",
          ...(init.headers || {}),
        },
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null) as T | null;
      if (!response.ok || !payload) throw new OpsRequestError(`Ops API ${path} failed with ${response.status}`, response.status);
      return payload;
    } finally {
      clearTimeout(timeout);
    }
  }

  async claim() {
    const payload = await this.request<{ claimed: boolean; session?: RuntimeSession }>("/api/internal/voice-platform/claim", {
      method: "POST",
      body: JSON.stringify({ workerId: this.config.workerId }),
    });
    return payload.claimed ? payload.session || null : null;
  }

  async getAttempt(attemptId: string) {
    const payload = await this.request<{ session: RuntimeSession }>(`/api/internal/voice-platform/attempts/${encodeURIComponent(attemptId)}`);
    return payload.session;
  }

  async recover() {
    const payload = await this.request<{ sessions: RecoveredRuntimeSession[] }>(`/api/internal/voice-platform/recover?workerId=${encodeURIComponent(this.config.workerId)}`);
    return payload.sessions;
  }

  async updateAttempt(attemptId: string, body: Record<string, unknown>) {
    return this.request(`/api/internal/voice-platform/attempts/${encodeURIComponent(attemptId)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }

  async tool(attemptId: string, toolCallId: string, toolName: string, args: string) {
    return this.request<{ duplicate: boolean; result: Record<string, unknown> }>("/api/internal/voice-platform/tools", {
      method: "POST",
      body: JSON.stringify({ attemptId, toolCallId, toolName, arguments: args }),
    });
  }

  async event(attemptId: string, source: string, eventType: string, idempotencyKey: string, payload: Record<string, unknown> = {}) {
    return this.request<{ ok: true; result: { event_id: string; duplicate: boolean } | null }>("/api/internal/voice-platform/events", {
      method: "POST",
      body: JSON.stringify({ attemptId, source, eventType, idempotencyKey, payload }),
    });
  }

  async finalize(attemptId: string, outcome: StructuredOutcome) {
    let result: unknown;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      try {
        result = await this.request("/api/internal/voice-platform/finalize", {
          method: "POST",
          body: JSON.stringify({ attemptId, outcome }),
        });
        break;
      } catch (error) {
        const retryable = !(error instanceof OpsRequestError) || error.status === 429 || error.status >= 500;
        if (!retryable || attempt === 5) throw error;
        await wait(250 * (2 ** (attempt - 1)));
      }
    }
    if (this.config.n8nOutcomeUrl) {
      try {
        const response = await fetch(this.config.n8nOutcomeUrl, {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.config.n8nWebhookToken}`,
            "content-type": "application/json",
            "x-neontrip-idempotency-key": `voice-outcome:${attemptId}`,
          },
          body: JSON.stringify({ attemptId, outcome }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw new Error(`n8n outcome returned ${response.status}`);
      } catch (error) {
        console.error("voice outcome n8n mirror failed", error instanceof Error ? error.message : "unknown error");
        await this.event(attemptId, "n8n", "outcome.mirror_failed", `n8n-outcome-failed:${attemptId}`, {
          status: "failed",
          error_code: "n8n_outcome_mirror_failed",
        }).catch((eventError) => console.error("voice outcome mirror failure event failed", eventError instanceof Error ? eventError.message : "unknown error"));
      }
    }
    return result;
  }
}

import type { RuntimeConfig } from "./config.js";
import type { RuntimeSession } from "./types.js";
import { signAttemptBinding, xmlEscape } from "./security.js";

export interface TelephonyAdapter {
  startOutboundCall(session: RuntimeSession): Promise<{ providerCallId: string }>;
  getCallStatus(providerCallId: string): Promise<string>;
  stopCall(providerCallId: string, status: "canceled" | "completed"): Promise<void>;
}

export class TwilioSipAdapter implements TelephonyAdapter {
  constructor(private readonly config: RuntimeConfig) {}

  private authorization() {
    return `Basic ${Buffer.from(`${this.config.twilioAccountSid}:${this.config.twilioAuthToken}`).toString("base64")}`;
  }

  private callUrl(providerCallId?: string) {
    const suffix = providerCallId ? `/${encodeURIComponent(providerCallId)}` : "";
    return `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.config.twilioAccountSid)}/Calls${suffix}.json`;
  }

  async startOutboundCall(session: RuntimeSession) {
    const binding = signAttemptBinding(session.attemptId, this.config.sipBindingSecret);
    const sipUri = `sip:${this.config.openAiProjectId}@sip.api.openai.com;transport=tls?x-neontrip-attempt-id=${encodeURIComponent(session.attemptId)}&x-neontrip-binding=${binding}`;
    const twiml = `<Response><Dial answerOnBridge="true"><Sip>${xmlEscape(sipUri)}</Sip></Dial></Response>`;
    const body = new URLSearchParams({
      To: session.phoneE164,
      From: this.config.twilioFromNumber,
      Twiml: twiml,
      StatusCallback: `${this.config.publicUrl}/webhooks/twilio?attemptId=${encodeURIComponent(session.attemptId)}`,
      StatusCallbackMethod: "POST",
      StatusCallbackEvent: "initiated ringing answered completed",
    });
    const response = await fetch(this.callUrl(), {
      method: "POST",
      headers: { authorization: this.authorization(), "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    const payload = await response.json().catch(() => null) as { sid?: string; message?: string } | null;
    if (!response.ok || !payload?.sid) throw new Error(`Twilio call creation failed with ${response.status}`);
    return { providerCallId: payload.sid };
  }

  async getCallStatus(providerCallId: string) {
    const response = await fetch(this.callUrl(providerCallId), {
      headers: { authorization: this.authorization() },
      signal: AbortSignal.timeout(10_000),
    });
    const payload = await response.json().catch(() => null) as { status?: string } | null;
    if (!response.ok || !payload?.status) throw new Error(`Twilio call lookup failed with ${response.status}`);
    return String(payload.status).toLowerCase();
  }

  async stopCall(providerCallId: string, status: "canceled" | "completed") {
    const response = await fetch(this.callUrl(providerCallId), {
      method: "POST",
      headers: { authorization: this.authorization(), "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ Status: status }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Twilio call stop failed with ${response.status}`);
  }
}

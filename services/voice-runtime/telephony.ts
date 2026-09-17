import type { RuntimeConfig } from "./config.js";
import type { RuntimeSession } from "./types.js";
import { TWILIO_MEDIA_PATH } from "./media-protocol.js";
import { signAttemptBinding, xmlEscape } from "./security.js";

export interface TelephonyAdapter {
  startOutboundCall(session: RuntimeSession): Promise<{ providerCallId: string }>;
  getCallStatus(providerCallId: string): Promise<string>;
  stopCall(providerCallId: string, status: "canceled" | "completed"): Promise<void>;
}

export class TwilioSipAdapter implements TelephonyAdapter {
  constructor(protected readonly config: RuntimeConfig) {}

  private authorization() {
    return `Basic ${Buffer.from(`${this.config.twilioAccountSid}:${this.config.twilioAuthToken}`).toString("base64")}`;
  }

  private callUrl(providerCallId?: string) {
    const suffix = providerCallId ? `/${encodeURIComponent(providerCallId)}` : "";
    return `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.config.twilioAccountSid)}/Calls${suffix}.json`;
  }

  protected outboundTwiml(session: RuntimeSession) {
    const binding = signAttemptBinding(session.attemptId, this.config.sipBindingSecret);
    const sipUri = `sip:${this.config.openAiProjectId}@sip.api.openai.com;transport=tls;secure=true?x-neontrip-attempt-id=${encodeURIComponent(session.attemptId)}&x-neontrip-binding=${binding}`;
    return `<Response><Dial answerOnBridge="true"><Sip>${xmlEscape(sipUri)}</Sip></Dial></Response>`;
  }

  async startOutboundCall(session: RuntimeSession) {
    const twiml = this.outboundTwiml(session);
    const body = new URLSearchParams({
      To: session.phoneE164,
      From: this.config.twilioFromNumber,
      Twiml: twiml,
      StatusCallback: `${this.config.publicUrl}/webhooks/twilio?attemptId=${encodeURIComponent(session.attemptId)}`,
      StatusCallbackMethod: "POST",
    });
    // REST encodes each array value separately; space-separated lists are TwiML-only.
    for (const event of ["initiated", "ringing", "answered", "completed"])
      body.append("StatusCallbackEvent", event);
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

export class TwilioMediaAdapter extends TwilioSipAdapter {
  protected outboundTwiml(session: RuntimeSession) {
    if (!session.allowlistOnly || session.modelId !== "gpt-live-1")
      throw new Error("media_internal_live_test_only");
    const url = new URL(this.config.publicUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash)
      throw new Error("invalid_media_public_url");
    url.protocol = "wss:";
    url.pathname = TWILIO_MEDIA_PATH;
    const binding = signAttemptBinding(session.attemptId, this.config.sipBindingSecret);
    // GPT-Live delivers the greeting too; the transcript confirms disclosure.
    return `<Response><Connect><Stream url="${xmlEscape(url.toString())}"><Parameter name="attemptId" value="${xmlEscape(session.attemptId)}"/><Parameter name="binding" value="${xmlEscape(binding)}"/></Stream></Connect><Hangup/></Response>`;
  }
}

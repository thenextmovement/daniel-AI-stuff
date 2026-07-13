import type { RuntimeConfig } from "./config.js";
import type { RuntimeSession } from "./types.js";
import { signAttemptBinding, xmlEscape } from "./security.js";

export interface TelephonyAdapter {
  startOutboundCall(session: RuntimeSession): Promise<{ providerCallId: string }>;
}

export class TwilioSipAdapter implements TelephonyAdapter {
  constructor(private readonly config: RuntimeConfig) {}

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
    const auth = Buffer.from(`${this.config.twilioAccountSid}:${this.config.twilioAuthToken}`).toString("base64");
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.config.twilioAccountSid)}/Calls.json`, {
      method: "POST",
      headers: { authorization: `Basic ${auth}`, "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    const payload = await response.json().catch(() => null) as { sid?: string; message?: string } | null;
    if (!response.ok || !payload?.sid) throw new Error(`Twilio call creation failed with ${response.status}`);
    return { providerCallId: payload.sid };
  }
}

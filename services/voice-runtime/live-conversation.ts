import { voiceScopeBlock, type VoiceScopeBlock } from "./conversation-policy.js";

export const LIVE_SILENCE_MS = 3500;
export const LIVE_SILENCE_INSTRUCTION = "Falls du weiterhin auf eine Antwort der Person wartest und niemand spricht: frage jetzt einmal kurz und freundlich ‚Sind Sie noch dran?‘. Hat die Person inzwischen gesprochen, antworte stattdessen auf ihr Anliegen. Keine Nachfrage während deiner Antwort, einer Prüfung oder einer erbetenen Denkpause; nicht wiederholen, solange die Person nicht wieder gesprochen hat.";

// No raw audio is retained. SIP sideband reflects PCM16LE/24k; the primary
// media bridge uses PCMU/8k. Activity estimates are NOT caller playback acks.
export class LiveConversation {
  private lastActivity = 0;
  private lastInputPacket = -Infinity;
  private outputUntil = 0;
  private assistantText = "";
  private inputText = "";
  private inputEnd = -Infinity;
  private lastSpeaker: "customer" | "assistant" | null = null;
  private asked = false;
  private holding = false;
  private stopped = false;
  private busy = new Set<string>();
  private blockedDelegations = new Set<string>();
  private reason: VoiceScopeBlock | null = null;
  private blockRevision = 0;
  hasAssistantText = false;

  get revision() { return this.blockRevision; }
  get blocked() { return this.reason !== null; }
  stop() { this.stopped = true; this.blockRevision++; }
  canUseResult(revision: number, delegationId: string) {
    return !this.stopped && !this.blocked && revision === this.blockRevision && !this.blockedDelegations.has(delegationId);
  }
  beginDelegation(id: string) {
    this.busy.add(id);
    if (this.blocked) this.blockedDelegations.add(id);
  }
  finishDelegation(id: string, continued: boolean) {
    if (!continued) this.busy.delete(id);
  }

  audio(speaker: "customer" | "assistant", encoded: string, format: "pcm16" | "pcmu", now: number) {
    if (this.stopped) return;
    // Invalid/missing activity data must not be mistaken for silence.
    if (!encoded || encoded.length > 256000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
      this.lastActivity = now;
      if (speaker === "customer") this.lastInputPacket = -Infinity;
      return;
    }
    const data = Buffer.from(encoded, "base64");
    if (!data.length || (format === "pcm16" && data.length % 2)) {
      this.lastActivity = now;
      return;
    }
    const stride = format === "pcm16" ? 2 : 1;
    const rate = format === "pcm16" ? 24000 : 8000;
    const duration = data.length / stride / rate * 1000;
    if (speaker === "customer") this.lastInputPacket = now;
    const start = speaker === "assistant" ? Math.max(now, this.outputUntil) : now;
    if (speaker === "assistant") this.outputUntil = start + duration;
    let energy = 0;
    for (let i = 0; i < data.length; i += stride) {
      let sample: number;
      if (format === "pcm16") sample = data.readInt16LE(i);
      else {
        const u = (~data[i]) & 255;
        const magnitude = (((u & 15) << 3) + 132) << ((u >> 4) & 7);
        sample = (u & 128) ? 132 - magnitude : magnitude - 132;
      }
      energy += sample * sample;
    }
    if (Math.sqrt(energy / (data.length / stride)) >= 180) this.lastActivity = Math.max(this.lastActivity, start + duration);
  }

  transcript(speaker: "customer" | "assistant", text: string, startMs: number, endMs: number, now: number): VoiceScopeBlock | null {
    if (this.stopped || !text.trim()) return null;
    this.lastActivity = Math.max(this.lastActivity, now);
    if (speaker === "assistant") {
      this.hasAssistantText = true;
      if (this.lastSpeaker !== "assistant") this.assistantText = "";
      this.assistantText = (this.assistantText + text).slice(-1600);
      this.lastSpeaker = speaker;
      return null;
    }
    // Fragments have no turn ID. Conservative grouping; each block invalidates
    // existing delegated work even when a later allowed turn resumes the call.
    const newTurn = this.lastSpeaker === "assistant" || startMs - this.inputEnd > 1200;
    if (newTurn) { this.inputText = ""; this.reason = null; this.holding = false; }
    this.inputText = (this.inputText + text).slice(-1600);
    this.inputEnd = Math.max(this.inputEnd, endMs);
    this.assistantText = "";
    this.asked = false;
    this.lastSpeaker = speaker;
    this.holding = /\b(moment|augenblick|uberlege|überlege|nachdenken|warten|warte|hold on|one moment)\b/i.test(this.inputText);
    const reason = voiceScopeBlock(this.inputText);
    if (!reason || this.reason) return null;
    this.reason = reason;
    this.blockRevision++;
    for (const id of this.busy) this.blockedDelegations.add(id);
    return reason;
  }

  poll(now: number): boolean {
    if (this.stopped || this.asked || this.holding || this.busy.size || this.blocked
      || !/\?\s*$/.test(this.assistantText) || now - this.lastInputPacket > 750
      || now - this.lastActivity < LIVE_SILENCE_MS || now < this.outputUntil) return false;
    this.asked = true;
    return true;
  }
}

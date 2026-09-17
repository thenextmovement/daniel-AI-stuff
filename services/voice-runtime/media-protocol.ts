import { verifyAttemptBinding, verifyTwilioSignature } from "./security.js";

export const TWILIO_MEDIA_PATH = "/media/twilio";
const SID = { account: /^AC[0-9a-f]{32}$/i, call: /^CA[0-9a-f]{32}$/i, stream: /^MZ[0-9a-f]{32}$/i };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Json = Record<string, unknown>;
function object(value: unknown): Json {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_media_object");
  return value as Json;
}
function unsigned(value: unknown) {
  if (typeof value !== "string" || !/^\d{1,12}$/.test(value)) throw new Error("invalid_media_sequence");
  return Number(value);
}
export function pcmuByteLength(audio: unknown): number {
  if (typeof audio !== "string" || !audio.length || audio.length > 86000 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(audio)) throw new Error("invalid_media_audio");
  const bytes = Buffer.from(audio, "base64");
  if (bytes.toString("base64") !== audio) throw new Error("invalid_media_audio");
  return bytes.length;
}

export function validateMediaUpgrade(input: {
  method?: string; path?: string; signature?: string; publicUrl: string; authToken: string;
}) {
  if (input.method !== "GET" || ![TWILIO_MEDIA_PATH, TWILIO_MEDIA_PATH + "/"].includes(input.path || "") || !input.authToken) return false;
  let origin: URL;
  try { origin = new URL(input.publicUrl); } catch { return false; }
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) return false;
  // Use the configured public origin, never forwarded Host headers. Both forms
  // refer to the same TLS endpoint; Twilio WSS handshakes can include a trailing slash.
  return ["https:", "wss:"].some(protocol => ["", "/"].some(suffix => {
    const url = new URL(TWILIO_MEDIA_PATH + suffix, origin);
    url.protocol = protocol;
    url.port = "";
    return verifyTwilioSignature({ signature: input.signature, url: url.toString(), params: new URLSearchParams(), authToken: input.authToken });
  }));
}

export type MediaStart = { streamSid: string; accountSid: string; callSid: string; attemptId: string; binding: string };
export function assertMediaAttempt(start: MediaStart, session: {
  attemptId: string; providerCallId?: string | null; allowlistOnly: boolean; modelId: string;
}, accountSid: string, secret: string) {
  if (!secret || start.accountSid !== accountSid || !UUID.test(start.attemptId) ||
    start.attemptId !== session.attemptId || start.callSid !== session.providerCallId ||
    !verifyAttemptBinding(start.attemptId, start.binding, secret)) throw new Error("media_attempt_binding_mismatch");
  if (!session.allowlistOnly || session.modelId !== "gpt-live-1") throw new Error("media_internal_live_test_only");
}

export type MediaEvent =
  | { type: "connected" }
  | { type: "start"; start: MediaStart }
  | { type: "audio"; audio: string }
  | { type: "mark"; name: string }
  | { type: "dtmf"; digit: string }
  | { type: "stop" };

/** One stream, ordered raw G.711 in both directions. No turn-based input muting. */
export class TwilioMediaProtocol {
  private connected = false;
  private started: MediaStart | null = null;
  private stopped = false;
  private sequence = 0;
  private inputChunk = 0;
  private inputTime = 0;
  private inputQueue: string[] = [];
  private inputBytes = 0;
  private consumeInput: ((audio: string) => void) | null = null;
  private outputSequence = 0;
  private pendingMarks = new Map<string, { bytes: number; sentAt: number }>();
  private pendingOutputBytes = 0;
  private peakOutputBytes = 0;
  private lastInputAt: number | null = null;
  private lastInputTimestamp = 0;
  private inputDeliveryExcessMs = 0;
  private startupBufferMs = 0;
  private activatedAt: number | null = null;
  private firstOutputMs: number | null = null;
  private outputAvailableUntil: number | null = null;
  private outputScheduleGapMs = 0;
  private playbackAckMs = 0;
  constructor(private readonly send: (event: Json) => void, private readonly now: () => number = () => performance.now()) {}

  read(raw: string): MediaEvent {
    if (Buffer.byteLength(raw) > 128000 || this.stopped) throw new Error("media_closed_or_oversized");
    const e = object(JSON.parse(raw));
    if (e.event === "connected") {
      if (this.connected || e.protocol !== "Call" || e.version !== "1.0.0") throw new Error("invalid_media_connection");
      this.connected = true;
      return { type: "connected" };
    }
    if (!this.connected || unsigned(e.sequenceNumber) !== this.sequence + 1) throw new Error("media_sequence_gap");
    this.sequence++;
    if (e.event === "start") {
      if (this.started) throw new Error("duplicate_media_start");
      const s = object(e.start), format = object(s.mediaFormat), params = object(s.customParameters);
      if (typeof e.streamSid !== "string" || !SID.stream.test(e.streamSid) || e.streamSid !== s.streamSid ||
        typeof s.callSid !== "string" || !SID.call.test(s.callSid) ||
        typeof s.accountSid !== "string" || !SID.account.test(s.accountSid) ||
        !Array.isArray(s.tracks) || s.tracks.length !== 1 || s.tracks[0] !== "inbound" ||
        format.encoding !== "audio/x-mulaw" || format.sampleRate !== 8000 || format.channels !== 1 ||
        typeof params.attemptId !== "string" || !UUID.test(params.attemptId) || typeof params.binding !== "string" || !/^[0-9a-f]{64}$/.test(params.binding)) throw new Error("invalid_media_start");
      this.started = {streamSid:e.streamSid, accountSid:s.accountSid, callSid:s.callSid, attemptId:params.attemptId, binding:params.binding};
      return { type: "start", start: this.started };
    }
    if (!this.started || e.streamSid !== this.started.streamSid) throw new Error("media_stream_mismatch");
    if (e.event === "media") {
      const m = object(e.media), bytes = pcmuByteLength(m.payload);
      if (m.track !== "inbound" || unsigned(m.chunk) !== this.inputChunk + 1 || unsigned(m.timestamp) < this.inputTime) throw new Error("media_input_gap");
      const receivedAt = this.now(), timestamp = unsigned(m.timestamp);
      if (this.lastInputAt !== null) this.inputDeliveryExcessMs = Math.max(this.inputDeliveryExcessMs,
        receivedAt - this.lastInputAt - (timestamp - this.lastInputTimestamp));
      this.lastInputAt = receivedAt;
      this.lastInputTimestamp = timestamp;
      this.inputChunk++;
      this.inputTime = timestamp;
      const audio = m.payload as string;
      if (this.consumeInput) this.consumeInput(audio);
      else {
        if (this.inputBytes + bytes > 40000) throw new Error("media_startup_backlog");
        this.inputQueue.push(audio);
        this.inputBytes += bytes;
      }
      return { type: "audio", audio };
    }
    if (e.event === "mark") {
      const name = object(e.mark).name;
      if (typeof name !== "string" || !this.pendingMarks.has(name)) throw new Error("unknown_playback_mark");
      // Marks acknowledge audio actually played by Twilio, not model generation.
      const acknowledgedAt = this.now();
      for (const [key, pending] of this.pendingMarks) {
        this.playbackAckMs = Math.max(this.playbackAckMs, acknowledgedAt - pending.sentAt);
        this.pendingOutputBytes -= pending.bytes;
        this.pendingMarks.delete(key);
        if (key === name) break;
      }
      return { type: "mark", name };
    }
    if (e.event === "dtmf") {
      const d = object(e.dtmf);
      if (d.track !== "inbound_track" || typeof d.digit !== "string" || !/^[0-9*#]$/.test(d.digit)) throw new Error("invalid_media_dtmf");
      return { type: "dtmf", digit: d.digit };
    }
    if (e.event === "stop") {
      const s = object(e.stop);
      if (s.accountSid !== this.started.accountSid || s.callSid !== this.started.callSid) throw new Error("media_stop_mismatch");
      this.stopped = true;
      return { type: "stop" };
    }
    throw new Error("unsupported_media_event");
  }

  activateInput(consume: (audio: string) => void) {
    if (!this.started || this.stopped || this.consumeInput) throw new Error("media_input_not_startable");
    this.activatedAt = this.now();
    this.startupBufferMs = this.inputBytes / 8;
    this.consumeInput = consume;
    for (const audio of this.inputQueue) consume(audio);
    this.inputQueue = [];
    this.inputBytes = 0;
  }

  output(audio: string) {
    if (!this.started || this.stopped) throw new Error("media_output_not_open");
    const bytes = pcmuByteLength(audio);
    if (this.pendingOutputBytes + bytes > 64000) throw new Error("media_playback_backlog");
    const name = "played-" + (++this.outputSequence);
    const sentAt = this.now();
    if (this.firstOutputMs === null && this.activatedAt !== null) this.firstOutputMs = sentAt - this.activatedAt;
    // A schedule gap may be a natural model pause; it is not itself packet loss.
    if (this.outputAvailableUntil !== null) this.outputScheduleGapMs = Math.max(this.outputScheduleGapMs, sentAt - this.outputAvailableUntil);
    this.outputAvailableUntil = Math.max(sentAt, this.outputAvailableUntil ?? sentAt) + bytes / 8;
    this.pendingMarks.set(name, { bytes, sentAt });
    this.pendingOutputBytes += bytes;
    this.peakOutputBytes = Math.max(this.peakOutputBytes, this.pendingOutputBytes);
    this.send({ event: "media", streamSid: this.started.streamSid, media: { payload: audio } });
    this.send({ event: "mark", streamSid: this.started.streamSid, mark: { name } });
  }

  get timingMetrics(): Record<string, number> {
    const metrics: Record<string, number> = {
      input_startup_buffer: this.startupBufferMs,
      input_delivery_excess_peak: this.inputDeliveryExcessMs,
      output_schedule_gap_peak: this.outputScheduleGapMs,
      playback_ack_peak: this.playbackAckMs,
    };
    if (this.firstOutputMs !== null) metrics.first_model_audio = this.firstOutputMs;
    return Object.fromEntries(Object.entries(metrics).map(([key, value]) => [key, Math.round(Math.max(0, value))]));
  }

  get peakPlaybackBufferMs() { return this.peakOutputBytes / 8; }

  get playbackComplete() { return this.pendingMarks.size === 0; }
}

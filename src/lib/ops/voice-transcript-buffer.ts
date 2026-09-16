import type { TranscriptSegment } from "./voice-history";

// Pending revisions stay in memory until acknowledged by the server.
export class VoiceTranscriptBuffer {
  private pending = new Map<string, TranscriptSegment>();
  private flushing: Promise<void> | null = null;
  constructor(
    private readonly send: (segments: TranscriptSegment[]) => Promise<void>,
  ) {}
  get size() {
    return this.pending.size;
  }
  stage(segment: TranscriptSegment) {
    const previous = this.pending.get(segment.id);
    if (!previous || segment.revision > previous.revision)
      this.pending.set(segment.id, { ...segment });
  }
  snapshot() {
    return [...this.pending.values()];
  }
  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = this.drain().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }
  private async drain() {
    while (this.pending.size) {
      const batch: TranscriptSegment[] = [];
      let bytes = 0;
      for (const segment of this.pending.values()) {
        const size = new TextEncoder().encode(JSON.stringify(segment)).length;
        if (size > 54_000) throw new Error("Sprachsegment ist zu groß.");
        if (batch.length && (bytes + size > 54_000 || batch.length === 50))
          break;
        batch.push({ ...segment });
        bytes += size;
      }
      await this.send(batch);
      for (const segment of batch) {
        if (this.pending.get(segment.id)?.revision === segment.revision)
          this.pending.delete(segment.id);
      }
    }
  }
}

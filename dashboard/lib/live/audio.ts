"use client";

export const INPUT_RATE = 16_000;
export const OUTPUT_RATE = 24_000;

export function rms(frame: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return Math.sqrt(sum / frame.length);
}

export function floatToPcm16Base64(frame: Float32Array): string {
  const pcm = new Int16Array(frame.length);
  for (let i = 0; i < frame.length; i++) {
    const s = Math.max(-1, Math.min(1, frame[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(pcm.buffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function pcm16Base64ToFloat(b64: string): Float32Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const pcm = new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2));
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] / 0x8000;
  return out;
}

/**
 * Noise gate + echo guard (the two fixes from the Nov 3 test).
 * - Below the threshold, frames are replaced by silence, so room noise is never
 *   transcribed as speech.
 * - While JARVIS is speaking the threshold is multiplied, so leaked speaker
 *   audio (echo) does not trigger barge-in, but a real voice close to the mic does.
 * - A short hangover keeps the gate open between syllables.
 */
export class NoiseGate {
  private openUntil = 0;
  constructor(
    public threshold = 0.015,
    public echoMultiplier = 3.5,
    private hangoverMs = 350,
  ) {}

  pass(level: number, assistantSpeaking: boolean, now = performance.now()): boolean {
    const t = this.threshold * (assistantSpeaking ? this.echoMultiplier : 1);
    if (level >= t) this.openUntil = now + this.hangoverMs;
    return now < this.openUntil;
  }
}

/** Gapless PCM playback queue that can be flushed instantly on barge-in. */
export class Player {
  private ctx: AudioContext;
  private nextTime = 0;
  private sources = new Set<AudioBufferSourceNode>();
  onIdle?: () => void;

  constructor() {
    this.ctx = new AudioContext({ sampleRate: OUTPUT_RATE });
  }

  get speaking(): boolean {
    return this.sources.size > 0;
  }

  async resume() {
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  enqueue(samples: Float32Array) {
    const buf = this.ctx.createBuffer(1, samples.length, OUTPUT_RATE);
    buf.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.ctx.destination);
    const start = Math.max(this.ctx.currentTime + 0.02, this.nextTime);
    src.start(start);
    this.nextTime = start + buf.duration;
    this.sources.add(src);
    src.onended = () => {
      this.sources.delete(src);
      if (!this.sources.size) this.onIdle?.();
    };
  }

  /** Barge-in: stop everything immediately. */
  flush() {
    for (const s of this.sources) {
      s.onended = null;
      try { s.stop(); } catch { /* already stopped */ }
    }
    this.sources.clear();
    this.nextTime = 0;
    this.onIdle?.();
  }

  async close() {
    this.flush();
    await this.ctx.close();
  }
}

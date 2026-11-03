"use client";

import { GoogleGenAI, Modality, type LiveServerMessage, type Session } from "@google/genai";
import { floatToPcm16Base64, INPUT_RATE, NoiseGate, pcm16Base64ToFloat, Player, rms } from "./audio";

export type LiveState = "idle" | "connecting" | "listening" | "speaking" | "error";

export type TranscriptLine = { role: "user" | "jarvis" | "tool"; text: string; at: number };

export type LiveCallbacks = {
  onState: (s: LiveState, detail?: string) => void;
  onLine: (line: TranscriptLine) => void;
  onLatency: (ms: number, usedTool: boolean) => void;
  onLevel?: (level: number, gated: boolean) => void;
};

// First-person action claims. JARVIS has no write tools in the MVP, so any of
// these in its own speech is an honesty bug (reported to /api/flags).
const ACTION_CLAIM =
  /(أنا|انا|خلاص|تمام|حاضر)\s+(بعت|بعتت|عملت|سجلت|سجّلت|اتصلت|ضفت|أضفت|حدثت|حدّثت|أنشأت|انشأت)|تم\s+(ال)?(إرسال|ارسال|إنشاء|انشاء|تسجيل|التسجيل|تحديث)|(بعتّ|بعتت|بعتلك|بعتله|بعتلها)\s+(ال)?(رسال|ايميل|إيميل|واتساب)/;

export class JarvisLive {
  private session?: Session;
  private sessionId = "";
  private player?: Player;
  private micCtx?: AudioContext;
  private stream?: MediaStream;
  private node?: AudioWorkletNode;
  private gate = new NoiseGate();
  private closed = false;

  // per-turn bookkeeping
  private lastVoiceAt = 0;
  private turnStarted = false;
  private turnUsedTool = false;
  private userText = "";
  private jarvisText = "";

  constructor(private cb: LiveCallbacks) {}

  async start() {
    this.closed = false;
    this.cb.onState("connecting");
    try {
      const res = await fetch("/api/live-token", { method: "POST" });
      if (res.status === 423) throw new Error("الـ agents متوقفين من زرار الطوارئ");
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `token: ${res.status}`);
      }
      const { token, model, sessionId } = (await res.json()) as { token: string; model: string; sessionId: string };
      this.sessionId = sessionId;

      this.player = new Player();
      await this.player.resume();
      this.player.onIdle = () => {
        if (!this.closed && this.session) this.cb.onState("listening");
      };

      const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: "v1alpha" } });
      this.session = await ai.live.connect({
        model,
        // Real config is locked into the ephemeral token on the server.
        config: { responseModalities: [Modality.AUDIO] },
        callbacks: {
          onmessage: (m) => void this.onMessage(m),
          onerror: (e) => this.fail(e instanceof ErrorEvent ? e.message : "connection error"),
          onclose: (e) => {
            if (!this.closed) this.fail(e.reason || "الاتصال اتقفل");
          },
        },
      });

      await this.startMic();
      this.cb.onState("listening");
    } catch (e) {
      this.fail(e instanceof Error ? e.message : String(e));
    }
  }

  private async startMic() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    this.micCtx = new AudioContext({ sampleRate: INPUT_RATE });
    await this.micCtx.audioWorklet.addModule("/worklets/pcm-capture.js");
    const src = this.micCtx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.micCtx, "pcm-capture");
    this.node.port.onmessage = (ev: MessageEvent<Float32Array>) => this.onMicFrame(ev.data);
    src.connect(this.node);
  }

  private onMicFrame(frame: Float32Array) {
    if (!this.session) return;
    const level = rms(frame);
    const speaking = this.player?.speaking ?? false;
    const open = this.gate.pass(level, speaking);
    this.cb.onLevel?.(level, !open);
    if (open) this.lastVoiceAt = performance.now();
    // Gated frames are sent as silence so server-side VAD still sees the end of speech.
    const data = floatToPcm16Base64(open ? frame : new Float32Array(frame.length));
    this.session.sendRealtimeInput({ audio: { data, mimeType: `audio/pcm;rate=${INPUT_RATE}` } });
  }

  private async onMessage(m: LiveServerMessage) {
    const sc = m.serverContent;
    if (sc?.interrupted) {
      // Barge-in: user started talking over JARVIS.
      this.player?.flush();
      this.finishTurn(true);
    }
    if (sc?.inputTranscription?.text) this.userText += sc.inputTranscription.text;
    if (sc?.outputTranscription?.text) this.jarvisText += sc.outputTranscription.text;

    for (const part of sc?.modelTurn?.parts ?? []) {
      const data = part.inlineData?.data;
      if (!data) continue;
      if (!this.turnStarted) {
        this.turnStarted = true;
        if (this.lastVoiceAt) this.cb.onLatency(performance.now() - this.lastVoiceAt, this.turnUsedTool);
        this.flushUserLine();
      }
      this.player?.enqueue(pcm16Base64ToFloat(data));
      this.cb.onState("speaking");
    }

    if (sc?.turnComplete) this.finishTurn(false);

    if (m.toolCall?.functionCalls?.length) {
      this.turnUsedTool = true;
      this.flushUserLine();
      const responses = await Promise.all(
        m.toolCall.functionCalls.map(async (fc) => {
          this.cb.onLine({ role: "tool", text: fc.name ?? "?", at: Date.now() });
          const r = await fetch("/api/tools", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: fc.name, args: fc.args ?? {}, sessionId: this.sessionId }),
          }).then((x) => x.json()).catch(() => ({ output: { error: "network error" } }));
          return { id: fc.id, name: fc.name, response: { output: r.output } };
        }),
      );
      this.session?.sendToolResponse({ functionResponses: responses });
    }

    if (m.goAway) this.cb.onLine({ role: "tool", text: "السيشن قربت تخلص، افتح المايك تاني بعد شوية", at: Date.now() });
  }

  private flushUserLine() {
    const t = this.userText.trim();
    if (t) this.cb.onLine({ role: "user", text: t, at: Date.now() });
    this.userText = "";
  }

  private finishTurn(interrupted: boolean) {
    this.flushUserLine();
    const said = this.jarvisText.trim();
    if (said) {
      this.cb.onLine({ role: "jarvis", text: interrupted ? `${said} …` : said, at: Date.now() });
      const claim = said.match(ACTION_CLAIM);
      if (claim) {
        void fetch("/api/flags", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId: this.sessionId, transcript: said.slice(0, 4000), matched: claim[0].slice(0, 64) }),
        });
      }
    }
    this.jarvisText = "";
    this.turnStarted = false;
    this.turnUsedTool = false;
  }

  private fail(detail: string) {
    void this.stop().then(() => this.cb.onState("error", detail));
  }

  async stop() {
    this.closed = true;
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    await this.micCtx?.close().catch(() => {});
    await this.player?.close().catch(() => {});
    try { this.session?.close(); } catch { /* ignore */ }
    this.session = undefined;
    this.node = undefined;
    this.stream = undefined;
    this.micCtx = undefined;
    this.player = undefined;
    this.cb.onState("idle");
  }
}

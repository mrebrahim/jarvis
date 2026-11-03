"use client";

import { useEffect, useRef, useState } from "react";
import { JarvisLive, type LiveState, type TranscriptLine } from "@/lib/live/jarvis-live";

const LABEL: Record<LiveState, string> = {
  idle: "اضغط واتكلم",
  connecting: "بيتوصل…",
  listening: "سامعك",
  speaking: "بيتكلم — قاطعه لو عايز",
  error: "حصلت مشكلة",
};

/** D-2: live voice with Gemini Live from the browser. */
export function MicButton({ disabled }: { disabled: boolean }) {
  const live = useRef<JarvisLive | null>(null);
  const [state, setState] = useState<LiveState>("idle");
  const [detail, setDetail] = useState("");
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [latency, setLatency] = useState<{ ms: number; tool: boolean } | null>(null);
  const [level, setLevel] = useState({ v: 0, gated: true });

  useEffect(() => {
    // Kill switch pulled while talking → hang up immediately.
    if (disabled) void live.current?.stop();
  }, [disabled]);

  useEffect(() => () => void live.current?.stop(), []);

  async function toggle() {
    if (state === "idle" || state === "error") {
      setDetail("");
      live.current = new JarvisLive({
        onState: (s, d) => { setState(s); if (d) setDetail(d); },
        onLine: (l) => setLines((prev) => [...prev.slice(-30), l]),
        onLatency: (ms, tool) => setLatency({ ms: Math.round(ms), tool }),
        onLevel: (v, gated) => setLevel({ v, gated }),
      });
      await live.current.start();
    } else {
      await live.current?.stop();
    }
  }

  const active = state !== "idle" && state !== "error";
  const target = latency ? (latency.tool ? 5000 : 2000) : 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-4">
        <button
          onClick={toggle}
          disabled={disabled && !active}
          aria-label={active ? "اقفل المايك" : "افتح المايك"}
          className={`relative grid size-16 shrink-0 place-items-center rounded-full text-2xl text-white transition disabled:opacity-40 ${
            active ? "bg-danger" : "bg-accent"
          }`}
        >
          {active && !level.gated && (
            <span className="absolute inset-0 animate-ping rounded-full bg-accent/40" />
          )}
          <span className="relative">{active ? "■" : "🎙"}</span>
        </button>
        <div className="min-w-0">
          <div className="font-semibold">{disabled && !active ? "الـ agents متوقفين" : LABEL[state]}</div>
          {detail && <div className="text-xs text-danger">{detail}</div>}
          {latency && (
            <div className={`num text-xs ${latency.ms > target ? "text-warn" : "text-muted"}`}>
              أول صوت بعد {(latency.ms / 1000).toFixed(1)} ث {latency.tool ? "(مع tool)" : ""}
            </div>
          )}
        </div>
      </div>
      {lines.length > 0 && (
        <ol className="flex max-h-64 flex-col gap-1 overflow-y-auto text-sm">
          {lines.map((l, i) => (
            <li key={i} className={l.role === "user" ? "text-muted" : l.role === "tool" ? "font-mono text-xs text-accent" : ""}>
              {l.role === "user" ? "انت: " : l.role === "tool" ? "⚙ " : "JARVIS: "}
              {l.text}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

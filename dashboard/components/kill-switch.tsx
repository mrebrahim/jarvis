"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

/** D-4: stops every agent immediately (live tools, n8n write flows, OpenClaw, courses agent). */
export function KillSwitch({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function toggle() {
    const next = !enabled;
    if (!next && !confirm("توقف كل الـ agents دلوقتي؟ أي موافقة مستنية هتترفض.")) return;
    setBusy(true);
    setError("");
    const { error } = await createClient().rpc("set_agents_enabled", {
      p_enabled: next,
      p_reason: next ? null : "kill switch from dashboard",
    });
    setBusy(false);
    if (error) setError(error.message);
    else onChange(next);
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-danger">{error}</span>}
      <button
        onClick={toggle}
        disabled={busy}
        className={`rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-60 ${
          enabled ? "bg-danger" : "bg-accent"
        }`}
      >
        {enabled ? "⏻ وقّف كل الـ agents" : "شغّل الـ agents تاني"}
      </button>
    </div>
  );
}

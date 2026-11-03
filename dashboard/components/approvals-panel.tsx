"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Approval, ToolCall } from "@/lib/types";
import { Card, Empty, fmtTime } from "./ui";

/** D-3: pending outbound actions + audit of every tool call. */
export function ApprovalsPanel({ approvals, toolCalls, onDecided }: {
  approvals: Approval[]; toolCalls: ToolCall[]; onDecided: (id: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function decide(id: string, approve: boolean) {
    setBusy(id);
    setError("");
    const { error } = await createClient().rpc("decide_approval", { p_id: id, p_approve: approve });
    setBusy(null);
    if (error) setError(error.message);
    else onDecided(id);
  }

  return (
    <>
      <Card title={`موافقات مستنياك (${approvals.length})`}>
        {error && <p className="mb-2 text-xs text-danger">{error}</p>}
        {approvals.length === 0 ? (
          <Empty>مفيش حاجة مستنية تأكيدك.</Empty>
        ) : (
          <ul className="flex flex-col gap-3">
            {approvals.map((a) => (
              <li key={a.id} className="rounded-lg border border-border p-3">
                <div className="mb-1 text-xs text-muted">
                  {a.agent} · {a.action} · بتنتهي {fmtTime(a.expires_at)}
                </div>
                <p className="mb-2 text-sm">{a.summary}</p>
                <div className="flex gap-2">
                  <button disabled={busy === a.id} onClick={() => decide(a.id, true)}
                    className="rounded-md bg-accent px-3 py-1 text-sm text-white disabled:opacity-60">أكّد</button>
                  <button disabled={busy === a.id} onClick={() => decide(a.id, false)}
                    className="rounded-md border border-border px-3 py-1 text-sm disabled:opacity-60">ارفض</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="آخر الأدوات اللي اتنادت">
        {toolCalls.length === 0 ? (
          <Empty>لسه مفيش.</Empty>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {toolCalls.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2">
                <span dir="ltr" className="truncate font-mono text-xs">{t.tool}</span>
                <span className="flex items-center gap-2 text-xs text-muted">
                  <span className={t.status === "ok" ? "" : "text-danger"}>{t.status}</span>
                  {t.duration_ms != null && <span className="num">{t.duration_ms}ms</span>}
                  <span>{fmtTime(t.created_at)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

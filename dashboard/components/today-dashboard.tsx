"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Approval, Overview, ToolCall } from "@/lib/types";
import { ApprovalsPanel } from "./approvals-panel";
import { KillSwitch } from "./kill-switch";
import { MicButton } from "./mic-button";
import { Card, Empty, fmtNum, fmtTime, Stat } from "./ui";

const WATCHED = [
  "wa_conversations", "wa_messages", "leads_daily", "team_activity",
  "social_metrics", "events", "approvals", "agent_controls", "tool_calls",
] as const;

const PLATFORM: Record<string, string> = { youtube: "يوتيوب", facebook: "فيسبوك", instagram: "انستجرام", tiktok: "تيك توك" };
const DEPT: Record<string, string> = { media: "ميديا", sales: "سيلز", support: "دعم", management: "إدارة" };

/** D-1: everything for today on one page, refreshed live from Supabase Realtime. */
export function TodayDashboard({ initialOverview, initialApprovals, initialToolCalls }: {
  initialOverview: Overview | null; initialApprovals: Approval[]; initialToolCalls: ToolCall[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const [o, setO] = useState(initialOverview);
  const [approvals, setApprovals] = useState(initialApprovals);
  const [toolCalls, setToolCalls] = useState(initialToolCalls);
  const [live, setLive] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    const [ov, ap, tc] = await Promise.all([
      supabase.rpc("today_overview"),
      supabase.from("approvals").select("id, agent, action, level, summary, status, expires_at, created_at")
        .eq("status", "pending").gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }),
      supabase.from("tool_calls").select("id, agent, tool, status, duration_ms, created_at")
        .order("created_at", { ascending: false }).limit(15),
    ]);
    if (ov.data) setO(ov.data as Overview);
    if (ap.data) setApprovals(ap.data as Approval[]);
    if (tc.data) setToolCalls(tc.data as ToolCall[]);
  }, [supabase]);

  useEffect(() => {
    // Debounce bursts (e.g. n8n upserting 50 leads) into one refresh.
    const schedule = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(refresh, 400);
    };
    let ch = supabase.channel("today");
    for (const table of WATCHED) {
      ch = ch.on("postgres_changes", { event: "*", schema: "public", table }, schedule);
    }
    ch.subscribe((status) => setLive(status === "SUBSCRIBED"));
    const minute = setInterval(refresh, 60_000); // also expires approvals on screen
    return () => {
      clearInterval(minute);
      if (timer.current) clearTimeout(timer.current);
      void supabase.removeChannel(ch);
    };
  }, [supabase, refresh]);

  if (!o) {
    return <main className="p-6"><Empty>مش قادر أجيب داتا النهارده. اتأكد إن الـ migration اتطبق.</Empty></main>;
  }

  const enabled = o.agents_enabled;

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">النهارده</h1>
          <p className="text-xs text-muted">
            {new Intl.DateTimeFormat("ar-EG", { dateStyle: "full", timeZone: "Africa/Cairo" }).format(new Date(o.day))}
            {" · "}
            <span className={live ? "text-accent" : "text-warn"}>{live ? "● لايف" : "○ مش متصل"}</span>
          </p>
        </div>
        <KillSwitch enabled={enabled} onChange={(v) => setO({ ...o, agents_enabled: v })} />
      </header>

      {!enabled && (
        <div className="rounded-lg border border-danger p-3 text-sm text-danger">
          كل الـ agents متوقفين. مفيش أي أداة هتتنادي لحد ما تشغلهم تاني.
        </div>
      )}

      {o.open_events.length > 0 && (
        <ul className="flex flex-col gap-1">
          {o.open_events.map((e, i) => (
            <li key={i} className={`rounded-lg border p-2 text-sm ${
              e.severity === "critical" ? "border-danger text-danger" : e.severity === "warning" ? "border-warn text-warn" : "border-border"
            }`}>
              {e.title} <span className="text-xs text-muted">· {fmtTime(e.at)}</span>
            </li>
          ))}
        </ul>
      )}

      <Card title="كلّم JARVIS">
        <MicButton disabled={!enabled} />
      </Card>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card title="الليدز الجديدة">
          <div className="mb-3 flex gap-6">
            <Stat label="ليد جديد" value={fmtNum(o.leads.new_count)} />
          </div>
          {Object.keys(o.leads.by_source).length > 0 && (
            <p className="mb-2 text-xs text-muted">
              {Object.entries(o.leads.by_source).map(([s, n]) => `${s}: ${n}`).join(" · ")}
            </p>
          )}
          {o.leads.items.length === 0 ? <Empty>مفيش ليدز جديدة متسجلة النهارده.</Empty> : (
            <ul className="flex flex-col gap-1 text-sm">
              {o.leads.items.slice(0, 8).map((l) => (
                <li key={l.id} className="flex justify-between gap-2">
                  <span className="truncate">{l.name ?? `#${l.id}`}</span>
                  <span className="shrink-0 text-xs text-muted">{l.source ?? "—"} · {l.status ?? "—"}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="واتساب الدعم">
          <div className="mb-3 flex gap-6">
            <Stat label="عندهم مشكلة" value={fmtNum(o.support.issues)} />
            <Stat label="لسه ماتحلتش" value={fmtNum(o.support.unresolved)} tone={o.support.unresolved ? "warn" : undefined} />
            <Stat label="غضبانين" value={fmtNum(o.support.angry)} tone={o.support.angry ? "danger" : undefined} />
          </div>
          {o.support.items.length === 0 ? <Empty>مفيش مشاكل متسجلة النهارده.</Empty> : (
            <ul className="flex flex-col gap-2 text-sm">
              {o.support.items.slice(0, 6).map((s, i) => (
                <li key={i}>
                  <div className="flex justify-between gap-2">
                    <span className="font-medium">{s.contact}</span>
                    <span className={`text-xs ${s.status === "resolved" ? "text-accent" : "text-warn"}`}>
                      {s.status === "resolved" ? "اتحلت" : "مفتوحة"}
                    </span>
                  </div>
                  {s.summary && <p className="text-xs text-muted">{s.summary}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="واتساب السيلز">
          <div className="mb-3 flex gap-6">
            <Stat label="اتواصلنا معاهم" value={fmtNum(o.sales.contacted)} />
            <Stat label="ردّوا" value={fmtNum(o.sales.replied)} />
            <Stat label="ماردّوش" value={fmtNum(o.sales.no_reply.length)} />
          </div>
          {o.sales.no_reply.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm">
              {o.sales.no_reply.slice(0, 8).map((n, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span className="truncate">{n.contact}</span>
                  <span className="shrink-0 text-xs text-muted">{n.contacted_by ?? "—"} · {fmtTime(n.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="الفريق النهارده" className="md:col-span-2">
          {o.team.length === 0 ? <Empty>مفيش أعضاء فريق متسجلين في team_members.</Empty> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted">
                  <tr>
                    <th className="py-1 text-start font-normal">الاسم</th>
                    <th className="font-normal">القسم</th>
                    <th className="font-normal">مهام اتقفلت</th>
                    <th className="font-normal">ساعات</th>
                    <th className="font-normal">محادثات</th>
                    <th className="font-normal">بوستات</th>
                  </tr>
                </thead>
                <tbody className="num">
                  {o.team.map((t) => {
                    const idle = !t.tasks_closed && !t.hours && !t.conversations && !t.posts;
                    return (
                      <tr key={t.name} className="border-t border-border">
                        <td className={`py-1.5 ${idle ? "text-muted" : "font-medium"}`}>{t.name}</td>
                        <td className="text-center text-xs text-muted">{DEPT[t.department] ?? t.department}</td>
                        <td className="text-center">{fmtNum(t.tasks_closed)}</td>
                        <td className="text-center">{fmtNum(t.hours)}</td>
                        <td className="text-center">{fmtNum(t.conversations)}</td>
                        <td className="text-center">{fmtNum(t.posts)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="السوشيال">
          {o.social.length === 0 ? <Empty>لسه مفيش مؤشرات سوشيال (S-1 في v2).</Empty> : (
            <ul className="flex flex-col gap-2 text-sm">
              {o.social.map((s) => (
                <li key={s.platform} className="flex justify-between gap-2">
                  <span>{PLATFORM[s.platform] ?? s.platform}</span>
                  <span className="num text-xs text-muted">
                    {fmtNum(s.views)} مشاهدة · +{fmtNum(s.new_followers)} متابع
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <ApprovalsPanel
          approvals={approvals}
          toolCalls={toolCalls}
          onDecided={(id) => setApprovals((a) => a.filter((x) => x.id !== id))}
        />
      </div>
    </main>
  );
}

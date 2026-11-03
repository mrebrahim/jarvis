import { redirect } from "next/navigation";
import { getOwner } from "@/lib/auth";
import { TodayDashboard } from "@/components/today-dashboard";
import type { Approval, Overview, ToolCall } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Page() {
  const ctx = await getOwner();
  if (!ctx) {
    // Signed in but not in app_owners, or not signed in at all.
    redirect("/login");
  }
  const [overview, approvals, toolCalls] = await Promise.all([
    ctx.supabase.rpc("today_overview"),
    ctx.supabase
      .from("approvals")
      .select("id, agent, action, level, summary, status, expires_at, created_at")
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false }),
    ctx.supabase
      .from("tool_calls")
      .select("id, agent, tool, status, duration_ms, created_at")
      .order("created_at", { ascending: false })
      .limit(15),
  ]);

  return (
    <TodayDashboard
      initialOverview={overview.data as Overview | null}
      initialApprovals={(approvals.data ?? []) as Approval[]}
      initialToolCalls={(toolCalls.data ?? []) as ToolCall[]}
    />
  );
}

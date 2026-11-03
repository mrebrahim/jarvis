import { NextResponse } from "next/server";
import { z } from "zod";
import { agentsEnabled, getOwner } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { runTool, toolNames } from "@/lib/jarvis/tools";

export const dynamic = "force-dynamic";

const Body = z.object({
  name: z.string().max(64),
  args: z.record(z.string(), z.unknown()).default({}),
  sessionId: z.string().max(64).optional(),
});

/** Executes a Live tool call as the owner, enforcing the kill switch, and audits it in tool_calls. */
export async function POST(req: Request) {
  const ctx = await getOwner();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const { name, args, sessionId } = parsed.data;

  const admin = createAdminClient();
  const started = Date.now();
  const log = (status: "ok" | "error" | "blocked", output: unknown, error?: string) =>
    admin.from("tool_calls").insert({
      agent: "jarvis-live",
      session_id: sessionId ?? null,
      tool: name,
      input: args,
      output: output ?? null,
      status,
      error: error ?? null,
      duration_ms: Date.now() - started,
    }).select("id").single();

  if (!(await agentsEnabled(ctx))) {
    await log("blocked", null, "kill switch is on");
    return NextResponse.json({ output: { error: "الـ agents متوقفين من زرار الطوارئ" } });
  }
  if (!toolNames.has(name)) {
    await log("blocked", null, "unknown tool");
    return NextResponse.json({ output: { error: `الأداة ${name} مش موجودة` } });
  }

  try {
    const output = await runTool(ctx, name, args);
    const { data } = await log("ok", output);
    return NextResponse.json({ output, toolCallId: data?.id });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await log("error", null, message);
    return NextResponse.json({ output: { error: "حصل خطأ وأنا بجيب الداتا", detail: message } });
  }
}

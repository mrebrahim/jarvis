import { NextResponse } from "next/server";
import { z } from "zod";
import { getOwner } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const Body = z.object({
  sessionId: z.string().max(64).optional(),
  transcript: z.string().max(4000),
  matched: z.string().max(64),
});

/**
 * Honesty guard: the client reports any assistant turn that claims an action
 * ("بعت", "عملت"...) while no write tool exists. Stored as an event = bug.
 */
export async function POST(req: Request) {
  const ctx = await getOwner();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  await createAdminClient().from("events").insert({
    type: "honesty_violation",
    severity: "warning",
    title: `JARVIS ادّعى فعل ("${parsed.data.matched}") من غير tool call`,
    body: parsed.data.transcript,
    payload: { session_id: parsed.data.sessionId ?? null, agent: "jarvis-live" },
  });
  return NextResponse.json({ ok: true });
}

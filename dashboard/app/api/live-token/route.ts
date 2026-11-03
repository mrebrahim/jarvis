import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { agentsEnabled, getOwner } from "@/lib/auth";
import { serverEnv } from "@/lib/env";
import { buildLiveConfig } from "@/lib/jarvis/live-config";

export const dynamic = "force-dynamic";

/** Mints a single-use, short-lived Gemini Live token. The API key never leaves the server. */
export async function POST() {
  const ctx = await getOwner();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!(await agentsEnabled(ctx))) {
    return NextResponse.json({ error: "agents_disabled" }, { status: 423 });
  }

  let model: string;
  let apiKey: string;
  try {
    model = serverEnv.liveModel();
    apiKey = serverEnv.geminiApiKey();
  } catch (e) {
    // Names the missing env var only, never a value.
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
  const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "v1alpha" } });

  const now = Date.now();
  let token;
  try {
    token = await ai.authTokens.create({
      config: {
        uses: 1,
        expireTime: new Date(now + 30 * 60_000).toISOString(),
        newSessionExpireTime: new Date(now + 60_000).toISOString(),
        // No lockAdditionalFields: with constraints set and no field mask, the
        // server locks the whole config (prompt, tools, voice) to this token.
        liveConnectConstraints: { model, config: buildLiveConfig(today) },
        httpOptions: { apiVersion: "v1alpha" },
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("live-token: Gemini rejected token request", message);
    return NextResponse.json({ error: `Gemini: ${message.slice(0, 300)}`, model }, { status: 502 });
  }

  if (!token.name) return NextResponse.json({ error: "token_failed" }, { status: 502 });
  return NextResponse.json({ token: token.name, model, sessionId: crypto.randomUUID() });
}

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

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
  const model = serverEnv.liveModel();
  const ai = new GoogleGenAI({ apiKey: serverEnv.geminiApiKey(), httpOptions: { apiVersion: "v1alpha" } });

  const now = Date.now();
  const token = await ai.authTokens.create({
    config: {
      uses: 1,
      expireTime: new Date(now + 30 * 60_000).toISOString(),
      newSessionExpireTime: new Date(now + 60_000).toISOString(),
      liveConnectConstraints: { model, config: buildLiveConfig(today) },
      lockAdditionalFields: [],
      httpOptions: { apiVersion: "v1alpha" },
    },
  });

  if (!token.name) return NextResponse.json({ error: "token_failed" }, { status: 502 });
  return NextResponse.json({ token: token.name, model, sessionId: crypto.randomUUID() });
}

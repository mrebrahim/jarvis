"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    const { error } = await createClient().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/auth/callback`, shouldCreateUser: true },
    });
    if (error) {
      setError(error.message);
      setState("error");
    } else setState("sent");
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4">
      <h1 className="mb-1 text-2xl font-bold">JARVIS</h1>
      <p className="mb-6 text-sm text-muted">ادخل بالإيميل، هيوصلك لينك دخول.</p>
      {state === "sent" ? (
        <p className="rounded-lg border border-border bg-card p-4">بعتنالك لينك على {email}.</p>
      ) : (
        <form onSubmit={send} className="flex flex-col gap-3">
          <input
            type="email"
            required
            dir="ltr"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-lg border border-border bg-card px-3 py-2"
            placeholder="you@example.com"
          />
          <button
            disabled={state === "sending"}
            className="rounded-lg bg-accent px-3 py-2 font-medium text-white disabled:opacity-60"
          >
            {state === "sending" ? "بيتبعت…" : "ابعت لينك الدخول"}
          </button>
          {state === "error" && <p className="text-sm text-danger">{error}</p>}
        </form>
      )}
    </main>
  );
}

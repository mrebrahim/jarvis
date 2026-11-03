function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

export const serverEnv = {
  supabaseUrl: () => required("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: () => required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  serviceRoleKey: () => required("SUPABASE_SERVICE_ROLE_KEY"),
  geminiApiKey: () => required("GEMINI_API_KEY"),
  liveModel: () => required("GEMINI_LIVE_MODEL"),
  liveVoice: () => process.env.GEMINI_LIVE_VOICE || undefined,
};

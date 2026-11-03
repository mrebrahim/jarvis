import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";

/** Supabase client acting as the signed-in user (RLS applies). */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(serverEnv.supabaseUrl(), serverEnv.supabaseAnonKey(), {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component: middleware refreshes the session instead.
        }
      },
    },
  });
}

/**
 * Service-role client. Server only, used solely to append audit rows
 * (tool_calls / events) that the owner role cannot insert itself.
 */
export function createAdminClient() {
  return createSupabaseClient(serverEnv.supabaseUrl(), serverEnv.serviceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

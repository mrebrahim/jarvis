import "server-only";
import { createClient } from "@/lib/supabase/server";

export type OwnerContext = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
};

/** Returns the owner context, or null if the caller is not the signed-in owner. */
export async function getOwner(): Promise<OwnerContext | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: isOwner, error } = await supabase.rpc("is_owner");
  if (error || !isOwner) return null;
  return { supabase, userId: user.id };
}

/** Kill switch state (D-4). Fails closed: unknown state = disabled. */
export async function agentsEnabled(ctx: OwnerContext): Promise<boolean> {
  const { data, error } = await ctx.supabase
    .from("agent_controls")
    .select("agents_enabled")
    .single();
  if (error || !data) return false;
  return data.agents_enabled === true;
}

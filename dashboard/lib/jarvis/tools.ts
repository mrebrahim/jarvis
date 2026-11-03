import "server-only";
import { Type, type FunctionDeclaration } from "@google/genai";
import type { OwnerContext } from "@/lib/auth";

/**
 * MVP tool surface for JARVIS Live: level 0 (read-only) only.
 * Every tool reads rows that n8n already synced into Supabase, as the
 * signed-in owner (RLS applies). There is deliberately NO tool that sends,
 * creates or deletes anything — so any claim of "I sent / I created" is a bug.
 */

type Args = Record<string, unknown>;
type Executor = (ctx: OwnerContext, args: Args) => Promise<unknown>;

function cairoToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
}

function clampInt(v: unknown, min: number, max: number, dflt: number): number {
  const n = typeof v === "number" ? Math.trunc(v) : Number.parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}

function daysAgo(n: number): string {
  const d = new Date(`${cairoToday()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

async function unwrap<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}

export const toolDeclarations: FunctionDeclaration[] = [
  {
    name: "get_today_overview",
    description:
      "ملخص النهارده كله: الليدز الجديدة، مشاكل واتساب الدعم، تواصل السيلز، نشاط الفريق، السوشيال، التنبيهات. استخدمها لأي سؤال عام زي 'إيه اللي حصل النهارده'.",
  },
  {
    name: "get_new_leads",
    description: "الليدز الجديدة من Perfex خلال آخر عدد أيام، بالاسم والمصدر والحالة.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        days: { type: Type.INTEGER, description: "عدد الأيام (1 = النهارده بس). من 1 لـ 30." },
      },
    },
  },
  {
    name: "get_support_issues",
    description: "عملاء واتساب الدعم اللي عندهم مشكلة في يوم معين: ملخص المشكلة، اتحلت ولا لأ، والمشاعر.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        only_unresolved: { type: Type.BOOLEAN, description: "true = اللي لسه ماتحلتش بس" },
        days_ago: { type: Type.INTEGER, description: "0 = النهارده، 1 = امبارح" },
      },
    },
  },
  {
    name: "get_sales_outreach",
    description: "واتساب السيلز: اتواصلنا مع كام واحد، وكام واحد رد، ومين ماردش، ومين من الفريق كلمه.",
    parameters: {
      type: Type.OBJECT,
      properties: { days_ago: { type: Type.INTEGER, description: "0 = النهارده، 1 = امبارح" } },
    },
  },
  {
    name: "get_team_activity",
    description: "كل واحد في الفريق عمل إيه: مهام اتقفلت، ساعات، محادثات، بوستات. ممكن تحدد اسم.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        member_name: { type: Type.STRING, description: "اسم الشخص (اختياري)" },
        days_ago: { type: Type.INTEGER, description: "0 = النهارده، 1 = امبارح" },
      },
    },
  },
  {
    name: "get_social_metrics",
    description: "مؤشرات السوشيال (يوتيوب، فيسبوك، انستجرام، تيك توك) لآخر 14 يوم: مشاهدات ومتابعين وأحسن بوست.",
  },
];

const executors: Record<string, Executor> = {
  async get_today_overview(ctx) {
    return unwrap(ctx.supabase.rpc("today_overview"));
  },

  async get_new_leads(ctx, args) {
    const days = clampInt(args.days, 1, 30, 1);
    const since = daysAgo(days - 1);
    const rows = (await unwrap(ctx.supabase.rpc("new_leads", { p_since: since }))) as unknown[] | null;
    return { since, count: rows?.length ?? 0, leads: rows ?? [] };
  },

  async get_support_issues(ctx, args) {
    const day = daysAgo(clampInt(args.days_ago, 0, 30, 0));
    let q = ctx.supabase
      .from("wa_conversations")
      .select("contact_name, contact_number, summary, status, sentiment, last_message_at, wa_instances!inner(purpose)")
      .eq("wa_instances.purpose", "support")
      .eq("day", day)
      .eq("category", "issue")
      .order("last_message_at", { ascending: false })
      .limit(50);
    if (args.only_unresolved === true) q = q.neq("status", "resolved");
    const rows = (await unwrap(q)) ?? [];
    return {
      day,
      count: rows.length,
      issues: rows.map((r) => ({
        customer: r.contact_name ?? r.contact_number,
        summary: r.summary,
        status: r.status,
        sentiment: r.sentiment,
      })),
    };
  },

  async get_sales_outreach(ctx, args) {
    const day = daysAgo(clampInt(args.days_ago, 0, 30, 0));
    const rows = ((await unwrap(ctx.supabase.rpc("sales_outreach", { p_day: day }))) ?? []) as Array<{
      contact_number: string; contact_name: string | null; replied: boolean; contacted_by: string | null;
    }>;
    return {
      day,
      contacted: rows.length,
      replied: rows.filter((r) => r.replied).length,
      no_reply: rows
        .filter((r) => !r.replied)
        .map((r) => ({ contact: r.contact_name ?? r.contact_number, contacted_by: r.contacted_by })),
    };
  },

  async get_team_activity(ctx, args) {
    const day = daysAgo(clampInt(args.days_ago, 0, 30, 0));
    const rows = ((await unwrap(
      ctx.supabase
        .from("team_activity")
        .select("kind, quantity, title, source, occurred_at, team_members!inner(name, department)")
        .eq("day", day)
        .order("occurred_at", { ascending: true })
        .limit(500),
    )) ?? []) as unknown as Array<{
      kind: string; quantity: number; title: string | null; source: string;
      team_members: { name: string; department: string };
    }>;
    const name = typeof args.member_name === "string" ? args.member_name.trim() : "";
    const filtered = name ? rows.filter((r) => r.team_members.name.includes(name)) : rows;
    const byMember: Record<string, { department: string; tasks_closed: number; hours: number;
      conversations: number; posts: number; items: string[] }> = {};
    for (const r of filtered) {
      const m = (byMember[r.team_members.name] ??= {
        department: r.team_members.department, tasks_closed: 0, hours: 0, conversations: 0, posts: 0, items: [],
      });
      if (r.kind === "task_closed") m.tasks_closed += Number(r.quantity);
      if (r.kind === "hours_logged") m.hours += Number(r.quantity);
      if (r.kind === "conversation") m.conversations += Number(r.quantity);
      if (r.kind === "post_published") m.posts += Number(r.quantity);
      if (r.title && m.items.length < 10) m.items.push(r.title);
    }
    return { day, members: byMember, note: name && !filtered.length ? "مفيش نشاط مسجّل للاسم ده" : undefined };
  },

  async get_social_metrics(ctx) {
    const rows = await unwrap(
      ctx.supabase
        .from("social_metrics")
        .select("platform, day, views, followers, new_followers, engagement, top_post")
        .gte("day", daysAgo(13))
        .order("day", { ascending: false }),
    );
    return { since: daysAgo(13), rows };
  },
};

export const toolNames = new Set(Object.keys(executors));

export async function runTool(ctx: OwnerContext, name: string, args: Args) {
  const exec = executors[name];
  if (!exec) throw new Error(`unknown tool: ${name}`);
  return exec(ctx, args);
}

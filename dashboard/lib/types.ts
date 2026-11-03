export type Overview = {
  day: string;
  generated_at: string;
  agents_enabled: boolean;
  leads: {
    new_count: number;
    by_source: Record<string, number>;
    items: { id: number; name: string | null; source: string | null; status: string | null; date_added: string }[];
  };
  support: {
    issues: number;
    unresolved: number;
    angry: number;
    items: { contact: string; summary: string | null; status: string; sentiment: string | null }[];
  };
  sales: {
    contacted: number;
    replied: number;
    no_reply: { contact: string; contacted_by: string | null; at: string }[];
  };
  team: { name: string; department: string; tasks_closed: number; hours: number; conversations: number; posts: number }[];
  social: { platform: string; day: string; views: number | null; followers: number | null; new_followers: number | null; top_post: { title?: string; url?: string; views?: number } | null }[];
  pending_approvals: number;
  open_events: { type: string; severity: "info" | "warning" | "critical"; title: string; at: string }[];
};

export type Approval = {
  id: string;
  agent: string;
  action: string;
  level: number;
  summary: string;
  status: string;
  expires_at: string;
  created_at: string;
};

export type ToolCall = {
  id: string;
  agent: string;
  tool: string;
  status: "ok" | "error" | "blocked";
  duration_ms: number | null;
  created_at: string;
};

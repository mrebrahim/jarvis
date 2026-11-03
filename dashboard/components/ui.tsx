export function Card({ title, children, aside, className = "" }: {
  title: string; children: React.ReactNode; aside?: React.ReactNode; className?: string;
}) {
  return (
    <section className={`rounded-xl border border-border bg-card p-4 ${className}`}>
      <header className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-muted">{title}</h2>
        {aside}
      </header>
      {children}
    </section>
  );
}

export function Stat({ label, value, tone }: { label: string; value: number | string; tone?: "danger" | "warn" }) {
  const color = tone === "danger" ? "text-danger" : tone === "warn" ? "text-warn" : "";
  return (
    <div>
      <div className={`num text-3xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted">{children}</p>;
}

export const fmtTime = (iso: string) =>
  new Intl.DateTimeFormat("ar-EG", { timeZone: "Africa/Cairo", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

export const fmtNum = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("ar-EG").format(n);

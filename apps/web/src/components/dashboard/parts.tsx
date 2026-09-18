import { Link } from "@tanstack/react-router";
import { ChevronRight, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type Tone = "default" | "good" | "warn" | "danger";

const TONE: Record<Tone, string> = {
  default: "bg-muted text-muted-foreground",
  good: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  warn: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  danger: "bg-red-500/10 text-red-600 dark:text-red-400",
};

/** One number worth knowing, linking to where it comes from. */
export function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = "default",
  to,
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
  to?: string;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span
          className={cn(
            "flex size-7 items-center justify-center rounded-lg",
            TONE[tone],
          )}
        >
          <Icon className="size-3.5" />
        </span>
      </div>
      <div
        className={cn(
          "mt-1 text-2xl font-semibold tabular-nums",
          tone === "danger" && "text-red-600 dark:text-red-400",
        )}
      >
        {value}
      </div>
      {hint && (
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {hint}
        </div>
      )}
    </>
  );
  const className =
    "block rounded-xl border border-border bg-card px-4 py-3 transition-colors";
  return to ? (
    <Link to={to} className={cn(className, "hover:bg-accent/40")}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

/** A titled block with an optional "see all" link. */
export function Section({
  title,
  hint,
  to,
  linkLabel,
  children,
  className,
}: {
  title: string;
  hint?: string;
  to?: string;
  linkLabel?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-4",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
        {to && linkLabel && (
          <Link
            to={to}
            className="flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground"
          >
            {linkLabel}
            <ChevronRight className="size-3.5" />
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return (
    <p className="py-4 text-center text-xs text-muted-foreground">{children}</p>
  );
}

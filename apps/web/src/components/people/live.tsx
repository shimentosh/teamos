import { Link } from "@tanstack/react-router";
import { Monitor, Timer } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { LivePerson } from "@/fetchers/people/get-live-people";
import { useActivitySpans } from "@/hooks/queries/agent/use-agent";
import useCompanySettings from "@/hooks/queries/company/use-company-settings";
import useLivePeople from "@/hooks/queries/people/use-live-people";
import { cn } from "@/lib/cn";
import { formatHours } from "@/lib/format-duration";
import { getInitials } from "@/lib/get-initials";
import resolveAvatarSrc from "@/lib/resolve-avatar-src";
import { zonedClock, zonedDay } from "@/lib/zoned-time";

type State = LivePerson["state"];

const DOT: Record<State, string> = {
  active: "bg-emerald-500",
  idle: "bg-amber-400",
  paused: "bg-slate-400",
  offline: "bg-muted-foreground/30",
};

/** Re-renders every `ms`, so "12m" ticks along without refetching. */
function useTick(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

export function LiveDot({
  state,
  className,
}: {
  state: State;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <span
      title={t(`people:live.state.${state}`)}
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        DOT[state],
        state === "active" && "shadow-[0_0_0_3px] shadow-emerald-500/20",
        className,
      )}
    />
  );
}

// A stable colour per app name, so VS Code always looks like VS Code.
const APP_TINTS = [
  "bg-sky-500",
  "bg-violet-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-teal-500",
  "bg-indigo-500",
  "bg-orange-500",
];
export function appTint(name: string | null | undefined) {
  if (!name) return "bg-muted-foreground/40";
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return APP_TINTS[hash % APP_TINTS.length] as string;
}

/** "VS Code · 12m", or the state when the app isn't shared with you. */
export function LiveAppChip({
  person,
  className,
}: {
  person: LivePerson;
  className?: string;
}) {
  const { t } = useTranslation();
  const now = useTick();
  if (person.state === "offline") return null;
  if (!person.app) {
    return (
      <span className={cn("text-xs text-muted-foreground", className)}>
        {t(`people:live.state.${person.state}`)}
      </span>
    );
  }
  const minutes = person.since
    ? Math.max(0, Math.floor((now - Date.parse(person.since)) / 60_000))
    : null;
  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 text-xs",
        person.state === "idle" && "text-muted-foreground",
        className,
      )}
      title={person.domain ?? undefined}
    >
      <span className={cn("size-2 shrink-0 rounded-sm", appTint(person.app))} />
      <span className="truncate">
        {person.app}
        {person.domain ? (
          <span className="text-muted-foreground"> · {person.domain}</span>
        ) : null}
      </span>
      {minutes !== null && (
        <span className="shrink-0 text-muted-foreground tabular-nums">
          {formatHours(minutes * 60)}
        </span>
      )}
    </span>
  );
}

function RunningTask({
  workspaceId,
  person,
}: {
  workspaceId: string;
  person: LivePerson;
}) {
  const { t } = useTranslation();
  const now = useTick();
  if (!person.timing) return null;
  if (!person.runningTask) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Timer className="size-3.5" />
        {t("people:live.timingTask")}
      </span>
    );
  }
  const task = person.runningTask;
  return (
    <Link
      to="/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId"
      params={{ workspaceId, projectId: task.projectId, taskId: task.id }}
      className="flex min-w-0 items-center gap-1.5 text-xs hover:underline"
    >
      <Timer className="size-3.5 shrink-0 text-emerald-500" />
      <span className="shrink-0 text-muted-foreground">{task.ref}</span>
      <span className="truncate">{task.title}</span>
      <span className="shrink-0 text-muted-foreground tabular-nums">
        {formatHours(Math.max(0, (now - Date.parse(task.startedAt)) / 1000))}
      </span>
    </Link>
  );
}

const ORDER: Record<State, number> = {
  active: 0,
  idle: 1,
  paused: 2,
  offline: 3,
};

/** Everyone at once: who's in, what they're in, and what they're timing. */
export function LiveBoard({
  workspaceId,
  onOpenPerson,
}: {
  workspaceId: string;
  onOpenPerson?: (userId: string) => void;
}) {
  const { t } = useTranslation();
  const { data = [], isLoading } = useLivePeople(workspaceId);
  const [workingOnly, setWorkingOnly] = useState(false);
  const people = useMemo(
    () =>
      [...data]
        .filter(
          (p) => !workingOnly || p.state === "active" || p.state === "idle",
        )
        .sort(
          (a, b) =>
            ORDER[a.state] - ORDER[b.state] || a.name.localeCompare(b.name),
        ),
    [data, workingOnly],
  );
  const counts = useMemo(() => {
    const c = { active: 0, idle: 0, paused: 0, offline: 0 };
    for (const p of data) c[p.state] += 1;
    return c;
  }, [data]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        {(["active", "idle", "paused", "offline"] as const).map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <LiveDot state={s} />
            <span className="font-medium tabular-nums">{counts[s]}</span>
            <span className="text-muted-foreground">
              {t(`people:live.state.${s}`)}
            </span>
          </span>
        ))}
        <label className="ms-auto flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={workingOnly}
            onChange={(e) => setWorkingOnly(e.target.checked)}
          />
          {t("people:live.workingOnly")}
        </label>
      </div>

      {!isLoading && people.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {t("people:live.nobody")}
        </p>
      )}

      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {people.map((p) => (
          <li key={p.userId}>
            <div
              className={cn(
                "flex h-full flex-col gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:bg-accent/30",
                p.state === "offline" && "opacity-60",
              )}
            >
              <div className="flex items-center gap-3">
                <span className="relative">
                  <Avatar className="size-9">
                    <AvatarImage
                      src={resolveAvatarSrc(p.image ?? undefined)}
                      alt=""
                    />
                    <AvatarFallback className="text-xs">
                      {getInitials(p.name)}
                    </AvatarFallback>
                  </Avatar>
                  <LiveDot
                    state={p.state}
                    className="absolute -right-0.5 -bottom-0.5 size-3 ring-2 ring-card"
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => onOpenPerson?.(p.userId)}
                    className="block max-w-full truncate text-left text-sm font-medium hover:underline"
                  >
                    {p.name}
                  </button>
                  <span className="block text-xs text-muted-foreground">
                    {p.clockedIn
                      ? t("people:live.clockedIn")
                      : t("people:live.notClockedIn")}
                  </span>
                </span>
                {!p.hasDesktopApp && (
                  <span
                    title={t("people:live.noDesktopApp")}
                    className="text-muted-foreground/60"
                  >
                    <Monitor className="size-4" />
                  </span>
                )}
              </div>
              <div className="min-h-5">
                <LiveAppChip person={p} />
              </div>
              <RunningTask workspaceId={workspaceId} person={p} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One person's "right now", for the top of their Activity tab. */
export function NowCard({
  workspaceId,
  userId,
}: {
  workspaceId: string;
  userId: string;
}) {
  const { t } = useTranslation();
  const { byUser } = useLivePeople(workspaceId);
  const person = byUser.get(userId);
  if (!person) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-border px-4 py-3">
      <span className="flex items-center gap-2 text-sm font-medium">
        <LiveDot state={person.state} />
        {t(`people:live.state.${person.state}`)}
      </span>
      <LiveAppChip person={person} className="text-sm" />
      <RunningTask workspaceId={workspaceId} person={person} />
      {!person.hasDesktopApp && (
        <span className="text-xs text-muted-foreground">
          {t("people:live.noDesktopApp")}
        </span>
      )}
    </div>
  );
}

/**
 * The day as a coloured strip: each block is a stretch in one app, idle is
 * hatched, gaps are empty. Hover a block for the app, site and times.
 */
export function DayTimeline({
  workspaceId,
  userId,
  day,
  clock,
}: {
  workspaceId: string;
  userId?: string;
  day: string;
  clock: (iso: string) => string;
}) {
  const { t } = useTranslation();
  const { data: spans = [] } = useActivitySpans(
    { workspaceId, userId, day },
    true,
  );
  if (spans.length === 0) return null;
  const start = Date.parse(spans[0]?.startedAt ?? "");
  const last = Math.max(...spans.map((s) => Date.parse(s.endedAt)));
  // Today runs until now, so a short stretch looks short.
  const end = Math.max(last, Math.min(Date.now(), last + 12 * 3_600_000));
  const width = Math.max(end - start, 1);

  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between text-xs text-muted-foreground">
        <span className="font-medium text-foreground">
          {t("people:live.timeline")}
        </span>
        <span className="tabular-nums">
          {clock(spans[0]?.startedAt ?? "")} –{" "}
          {clock(new Date(end).toISOString())}
        </span>
      </div>
      <div className="relative h-7 w-full overflow-hidden rounded-md bg-muted/50">
        {spans.map((s) => {
          const left = ((Date.parse(s.startedAt) - start) / width) * 100;
          const w =
            ((Date.parse(s.endedAt) - Date.parse(s.startedAt)) / width) * 100;
          return (
            <span
              key={`${s.startedAt}-${s.app}`}
              title={`${clock(s.startedAt)}–${clock(s.endedAt)} · ${
                s.state === "idle"
                  ? t("desktopActivity:idle")
                  : [s.app, s.domain].filter(Boolean).join(" · ") || "–"
              }`}
              className={cn(
                "absolute top-0 h-full",
                s.state === "idle"
                  ? "bg-[repeating-linear-gradient(45deg,var(--color-muted-foreground)_0_2px,transparent_2px_6px)] opacity-30"
                  : appTint(s.app),
              )}
              style={{ left: `${left}%`, width: `max(${w}%, 1px)` }}
            />
          );
        })}
      </div>
    </section>
  );
}

/** The top of someone's Activity tab: right now, then today as a strip. */
export function PersonLive({
  workspaceId,
  userId,
}: {
  workspaceId: string;
  userId: string;
}) {
  const { data: company } = useCompanySettings(workspaceId);
  const timeZone = company?.timezone ?? "UTC";
  return (
    <div className="space-y-4">
      <NowCard workspaceId={workspaceId} userId={userId} />
      <DayTimeline
        workspaceId={workspaceId}
        userId={userId}
        day={zonedDay(new Date(), timeZone)}
        clock={(iso) => zonedClock(iso, timeZone)}
      />
    </div>
  );
}

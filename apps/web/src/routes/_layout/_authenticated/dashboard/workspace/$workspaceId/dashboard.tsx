import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlarmClock,
  CalendarCheck,
  CheckCircle2,
  CircleDot,
  Clock,
  Inbox,
  ListTodo,
  Timer,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import WorkspaceLayout from "@/components/common/workspace-layout";
import { EmptyNote, Section, StatCard } from "@/components/dashboard/parts";
import PageTitle from "@/components/page-title";
import { projectHealth } from "@/components/project/projects-overview";
import { useAuth } from "@/components/providers/auth-provider/hooks/use-auth";
import { ActivityFeed } from "@/components/reports/activity-feed";
import {
  DailyBars,
  fillDays,
  InlineBar,
  Legend,
  type Series,
} from "@/components/reports/charts";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { ReportQuery } from "@/fetchers/reports";
import { useAttendanceStatus } from "@/hooks/queries/attendance/use-attendance";
import useCompanySettings from "@/hooks/queries/company/use-company-settings";
import { useCompanyToday, useOpenRequests } from "@/hooks/queries/company-os";
import useLivePeople from "@/hooks/queries/people/use-live-people";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import useRunningTimeEntry from "@/hooks/queries/time-entry/use-running-time-entry";
import { useReportSummary } from "@/hooks/queries/use-reports";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { cn } from "@/lib/cn";
import { formatDateMedium } from "@/lib/format";
import { formatHours } from "@/lib/format-duration";
import { getInitials } from "@/lib/get-initials";
import { addDaysToDay, zonedDay } from "@/lib/zoned-time";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/dashboard",
)({
  component: RouteComponent,
});

type Period = "today" | "week" | "month";
const PERIODS: Period[] = ["today", "week", "month"];

function periodRange(period: Period, today: string) {
  if (period === "today") return { from: today, to: today };
  if (period === "week") return { from: addDaysToDay(today, -6), to: today };
  return { from: addDaysToDay(today, -29), to: today };
}

function greetingKey(hour: number) {
  if (hour < 12) return "dashboard:greeting.morning";
  if (hour < 17) return "dashboard:greeting.afternoon";
  return "dashboard:greeting.evening";
}

function Face({ name, image }: { name: string; image?: string | null }) {
  return (
    <Avatar className="size-7">
      <AvatarImage src={image ?? ""} alt={name} />
      <AvatarFallback className="bg-muted text-[10px] font-semibold">
        {getInitials(name)}
      </AvatarFallback>
    </Avatar>
  );
}

const STATE_DOT: Record<string, string> = {
  active: "bg-emerald-500",
  idle: "bg-amber-500",
  paused: "bg-sky-500",
  offline: "bg-muted-foreground/40",
};

function RouteComponent() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const { workspaceId } = Route.useParams();
  const { user } = useAuth();
  const { canReadReports, canSeePeople, canApproveRequests, canSeeAllTasks } =
    useWorkspacePermission();
  // Team numbers for leads; everyone else sees their own.
  const team = Boolean(canReadReports());
  const seesPeople = Boolean(canSeePeople());
  const approver = Boolean(canApproveRequests());

  const { data: company } = useCompanySettings(workspaceId);
  const timeZone = company?.timezone ?? "UTC";
  const today = zonedDay(new Date(), timeZone);
  const [period, setPeriod] = useState<Period>("week");
  const range = periodRange(period, today);
  const base = `/dashboard/workspace/${workspaceId}`;

  const query: ReportQuery | null = company
    ? { workspaceId, from: range.from, to: range.to }
    : null;
  const { data: summary } = useReportSummary(query);
  const { data: companyToday } = useCompanyToday(workspaceId, seesPeople);
  const { data: live = [] } = useLivePeople(workspaceId);
  const { data: projects = [] } = useGetProjects({ workspaceId });
  const { data: open } = useOpenRequests(workspaceId, approver);
  const { data: myDay } = useAttendanceStatus(workspaceId);
  const { data: myTimer } = useRunningTimeEntry(workspaceId);

  const tasks = summary?.tasks;
  const time = summary?.time;
  const attendance = summary?.attendance.totals;

  const taskSeries: Series[] = [
    {
      key: "created",
      label: t("dashboard:tasks.created"),
      color: "var(--viz-series-1)",
    },
    {
      key: "completed",
      label: t("dashboard:tasks.completed"),
      color: "var(--viz-series-2)",
    },
  ];
  const hourSeries: Series[] = [
    {
      key: "hours",
      label: t("dashboard:time.hours"),
      color: "var(--viz-series-1)",
    },
  ];
  const taskDays = useMemo(
    () =>
      tasks
        ? fillDays(range.from, range.to, tasks.series, {
            created: 0,
            completed: 0,
          })
        : [],
    [tasks, range.from, range.to],
  );
  const hourDays = useMemo(
    () =>
      time
        ? fillDays(
            range.from,
            range.to,
            time.byDay.map((d) => ({ day: d.day, hours: d.seconds / 3600 })),
            { hours: 0 },
          )
        : [],
    [time, range.from, range.to],
  );

  const workingNow = live.filter((p) => p.runningTask);
  const health = useMemo(() => {
    const counts = { onTrack: 0, dueSoon: 0, atRisk: 0, done: 0, empty: 0 };
    for (const p of projects) counts[projectHealth(p)] += 1;
    return counts;
  }, [projects]);
  const atRisk = projects
    .filter((p) => projectHealth(p) === "atRisk")
    .slice(0, 5);
  const pendingApprovals =
    (open?.leave.length ?? 0) +
    (open?.expenses.filter((e) => e.status === "pending").length ?? 0);
  const topProjects = (time?.byProject ?? []).slice(0, 5);
  const maxProjectSeconds = Math.max(1, ...topProjects.map((p) => p.seconds));
  const people = (tasks?.byPerson ?? [])
    .map((p) => ({
      ...p,
      seconds:
        time?.byPerson.find((row) => row.userId === p.userId)?.seconds ?? 0,
    }))
    .sort((a, b) => b.open + b.overdue - (a.open + a.overdue))
    .slice(0, 8);
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone,
    }).format(new Date()),
  );
  const periodLabel = t(`dashboard:period.${period}`);

  return (
    <>
      <PageTitle title={t("dashboard:title")} />
      <WorkspaceLayout title={t("dashboard:title")}>
        <div className="mx-auto flex max-w-7xl flex-col gap-4 p-4 md:p-6">
          {/* Greeting and period */}
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold">
                {t(greetingKey(hour), {
                  name: user?.name?.split(" ")[0] ?? "",
                })}
              </h1>
              <p className="text-sm text-muted-foreground">
                {formatDateMedium(new Date())} ·{" "}
                {team ? t("dashboard:scope.team") : t("dashboard:scope.mine")}
              </p>
            </div>
            <ToggleGroup
              value={[period]}
              onValueChange={(value) => {
                const next = value[0] as Period | undefined;
                if (next) setPeriod(next);
              }}
            >
              {PERIODS.map((p) => (
                <ToggleGroupItem key={p} value={p} size="sm">
                  {t(`dashboard:period.${p}`)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          {/* Right now */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {seesPeople && companyToday ? (
              <StatCard
                icon={Users}
                label={t("dashboard:now.inToday")}
                value={`${companyToday.present}/${companyToday.people}`}
                hint={t("dashboard:now.inTodayHint")}
                tone={companyToday.present > 0 ? "good" : "default"}
                to={`${base}/attendance`}
              />
            ) : (
              <StatCard
                icon={CalendarCheck}
                label={t("dashboard:now.myDay")}
                value={
                  myDay?.clockedIn
                    ? t("dashboard:now.clockedIn")
                    : t("dashboard:now.notClockedIn")
                }
                hint={
                  myDay?.today
                    ? t("dashboard:now.workedToday", {
                        time: formatHours(myDay.today.workedMinutes * 60),
                      })
                    : undefined
                }
                tone={myDay?.clockedIn ? "good" : "default"}
                to={`${base}/attendance`}
              />
            )}
            {team ? (
              <StatCard
                icon={Timer}
                label={t("dashboard:now.workingNow")}
                value={workingNow.length}
                hint={t("dashboard:now.workingNowHint")}
                tone={workingNow.length > 0 ? "good" : "default"}
                to={`${base}/people`}
              />
            ) : (
              <StatCard
                icon={Timer}
                label={t("dashboard:now.myTimer")}
                value={myTimer ? t("dashboard:now.running") : "—"}
                hint={myTimer?.taskTitle ?? t("dashboard:now.noTimer")}
                tone={myTimer ? "good" : "default"}
                to={`${base}/time`}
              />
            )}
            <StatCard
              icon={ListTodo}
              label={t("dashboard:tasks.open")}
              value={tasks?.open ?? "—"}
              hint={
                canSeeAllTasks()
                  ? t("dashboard:tasks.openHintAll")
                  : t("dashboard:tasks.openHintMine")
              }
              to={`${base}/my-work`}
            />
            <StatCard
              icon={AlarmClock}
              label={t("dashboard:tasks.overdue")}
              value={tasks?.overdue ?? "—"}
              hint={t("dashboard:tasks.overdueHint")}
              tone={(tasks?.overdue ?? 0) > 0 ? "danger" : "good"}
              to={`${base}/reports?tab=tasks`}
            />
            <StatCard
              icon={CheckCircle2}
              label={t("dashboard:tasks.completedIn", { period: periodLabel })}
              value={tasks?.completed ?? "—"}
              hint={
                tasks?.averageCycleHours
                  ? t("dashboard:tasks.cycle", {
                      time: formatHours(
                        Math.round(tasks.averageCycleHours * 3600),
                      ),
                    })
                  : undefined
              }
              tone="good"
              to={`${base}/reports?tab=tasks`}
            />
            <StatCard
              icon={Clock}
              label={t("dashboard:time.trackedIn", { period: periodLabel })}
              value={time ? formatHours(time.trackedSeconds) : "—"}
              hint={
                attendance
                  ? t("dashboard:time.attended", {
                      time: formatHours(attendance.workedMinutes * 60),
                    })
                  : undefined
              }
              to={`${base}/time`}
            />
          </div>

          {/* Needs attention */}
          {(pendingApprovals > 0 ||
            (tasks?.overdue ?? 0) > 0 ||
            atRisk.length > 0) && (
            <div className="flex flex-wrap gap-2">
              {pendingApprovals > 0 && (
                <Link
                  to={`${base}/attendance`}
                  className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-700 hover:bg-amber-500/15 dark:text-amber-300"
                >
                  <Inbox className="size-3.5" />
                  {t("dashboard:attention.approvals", {
                    count: pendingApprovals,
                  })}
                </Link>
              )}
              {(tasks?.overdue ?? 0) > 0 && (
                <Link
                  to={`${base}/reports?tab=tasks`}
                  className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-500/15 dark:text-red-300"
                >
                  <AlarmClock className="size-3.5" />
                  {t("dashboard:attention.overdue", {
                    count: tasks?.overdue ?? 0,
                  })}
                </Link>
              )}
              {atRisk.length > 0 && (
                <Link
                  to={base}
                  className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-500/15 dark:text-red-300"
                >
                  <CircleDot className="size-3.5" />
                  {t("dashboard:attention.projectsAtRisk", {
                    count: health.atRisk,
                  })}
                </Link>
              )}
            </div>
          )}

          {/* Tasks and time */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Section
              title={t("dashboard:tasks.title")}
              hint={t("dashboard:tasks.chartHint", { period: periodLabel })}
              to={`${base}/reports?tab=tasks`}
              linkLabel={t("dashboard:seeReport")}
            >
              <Legend series={taskSeries} />
              <DailyBars
                data={taskDays}
                series={taskSeries}
                locale={locale}
                height={180}
              />
              {tasks && tasks.overdueTasks.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">
                    {t("dashboard:tasks.lateList")}
                  </p>
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {tasks.overdueTasks.slice(0, 5).map((task) => (
                      <li key={task.id}>
                        <Link
                          to="/dashboard/workspace/$workspaceId/project/$projectId/board"
                          params={{ workspaceId, projectId: task.projectId }}
                          search={{ taskId: task.id }}
                          className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent/40"
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {task.title}
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {task.assigneeName ?? t("dashboard:unassigned")}
                          </span>
                          {task.dueDate && (
                            <span className="shrink-0 text-xs text-red-600 dark:text-red-400">
                              {formatDateMedium(new Date(task.dueDate))}
                            </span>
                          )}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Section>

            <Section
              title={t("dashboard:time.title")}
              hint={t("dashboard:time.chartHint", { period: periodLabel })}
              to={`${base}/time`}
              linkLabel={t("dashboard:seeTimesheet")}
            >
              <DailyBars
                data={hourDays}
                series={hourSeries}
                locale={locale}
                format={(hours) => formatHours(Math.round(hours * 3600))}
                height={180}
              />
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  {t("dashboard:time.byProject")}
                </p>
                {topProjects.length === 0 ? (
                  <EmptyNote>{t("dashboard:time.empty")}</EmptyNote>
                ) : (
                  topProjects.map((p) => (
                    <div
                      key={p.projectId}
                      className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] items-center gap-3 text-sm"
                    >
                      <span className="truncate">{p.name}</span>
                      <InlineBar
                        value={p.seconds}
                        max={maxProjectSeconds}
                        label={p.name}
                      />
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {formatHours(p.seconds)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </Section>
          </div>

          {/* People and projects */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Section
              title={
                team
                  ? t("dashboard:people.title")
                  : t("dashboard:people.liveTitle")
              }
              hint={
                team
                  ? t("dashboard:people.hint", { period: periodLabel })
                  : t("dashboard:people.liveHint")
              }
              to={`${base}/people`}
              linkLabel={t("dashboard:seePeople")}
            >
              {team ? (
                people.length === 0 ? (
                  <EmptyNote>{t("dashboard:people.empty")}</EmptyNote>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-muted-foreground">
                          <th className="pb-2 font-normal">
                            {t("dashboard:people.person")}
                          </th>
                          <th className="pb-2 text-right font-normal">
                            {t("dashboard:people.open")}
                          </th>
                          <th className="pb-2 text-right font-normal">
                            {t("dashboard:people.done")}
                          </th>
                          <th className="pb-2 text-right font-normal">
                            {t("dashboard:people.late")}
                          </th>
                          <th className="pb-2 text-right font-normal">
                            {t("dashboard:people.hours")}
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {people.map((p) => {
                          const now = live.find((l) => l.userId === p.userId);
                          return (
                            <tr key={p.userId ?? "unassigned"}>
                              <td className="py-2">
                                <div className="flex min-w-0 items-center gap-2">
                                  <Face
                                    name={p.name ?? t("dashboard:unassigned")}
                                    image={p.image}
                                  />
                                  <div className="min-w-0">
                                    <div className="truncate">
                                      {p.name ?? t("dashboard:unassigned")}
                                    </div>
                                    {now?.runningTask && (
                                      <div className="truncate text-[11px] text-emerald-600 dark:text-emerald-400">
                                        ● {now.runningTask.title}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </td>
                              <td className="py-2 text-right tabular-nums">
                                {p.open}
                              </td>
                              <td className="py-2 text-right tabular-nums">
                                {p.completed}
                              </td>
                              <td
                                className={cn(
                                  "py-2 text-right tabular-nums",
                                  p.overdue > 0 &&
                                    "text-red-600 dark:text-red-400",
                                )}
                              >
                                {p.overdue}
                              </td>
                              <td className="py-2 text-right tabular-nums text-muted-foreground">
                                {p.seconds > 0 ? formatHours(p.seconds) : "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )
              ) : live.length === 0 ? (
                <EmptyNote>{t("dashboard:people.liveEmpty")}</EmptyNote>
              ) : (
                <ul className="space-y-2">
                  {live.slice(0, 8).map((p) => (
                    <li key={p.userId} className="flex items-center gap-2">
                      <span className="relative">
                        <Face name={p.name} image={p.image} />
                        <span
                          className={cn(
                            "absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-card",
                            STATE_DOT[p.state] ?? STATE_DOT.offline,
                          )}
                        />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm">{p.name}</div>
                        <div className="truncate text-[11px] text-muted-foreground">
                          {p.runningTask
                            ? p.runningTask.title
                            : t(`dashboard:people.state.${p.state}`)}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section
              title={t("dashboard:projects.title")}
              hint={t("dashboard:projects.hint", { count: projects.length })}
              to={base}
              linkLabel={t("dashboard:seeProjects")}
            >
              <div className="grid grid-cols-4 gap-2 text-center">
                {(
                  [
                    ["onTrack", "text-sky-600 dark:text-sky-400"],
                    ["dueSoon", "text-amber-600 dark:text-amber-400"],
                    ["atRisk", "text-red-600 dark:text-red-400"],
                    ["done", "text-emerald-600 dark:text-emerald-400"],
                  ] as const
                ).map(([key, color]) => (
                  <div key={key} className="rounded-lg bg-muted/40 py-2">
                    <div
                      className={cn(
                        "text-xl font-semibold tabular-nums",
                        color,
                      )}
                    >
                      {health[key]}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {t(`dashboard:projects.health.${key}`)}
                    </div>
                  </div>
                ))}
              </div>
              {projects.length === 0 ? (
                <EmptyNote>{t("dashboard:projects.empty")}</EmptyNote>
              ) : (
                <ul className="space-y-2">
                  {(atRisk.length > 0 ? atRisk : projects.slice(0, 5)).map(
                    (p) => (
                      <li key={p.id}>
                        <Link
                          to="/dashboard/workspace/$workspaceId/project/$projectId/board"
                          params={{ workspaceId, projectId: p.id }}
                          className="block rounded-lg px-2 py-1.5 hover:bg-accent/40"
                        >
                          <div className="flex items-center justify-between gap-2 text-sm">
                            <span className="truncate">{p.name}</span>
                            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                              {p.statistics.completedTasks}/
                              {p.statistics.totalTasks}
                            </span>
                          </div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                            <div
                              className={cn(
                                "h-full rounded-full",
                                projectHealth(p) === "atRisk"
                                  ? "bg-red-500"
                                  : "bg-emerald-500",
                              )}
                              style={{
                                width: `${p.statistics.completionPercentage}%`,
                              }}
                            />
                          </div>
                        </Link>
                      </li>
                    ),
                  )}
                </ul>
              )}
            </Section>
          </div>

          {/* Attendance and activity */}
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <Section
              title={t("dashboard:attendance.title")}
              hint={t("dashboard:attendance.hint", { period: periodLabel })}
              to={`${base}/attendance`}
              linkLabel={t("dashboard:seeAttendance")}
            >
              {attendance ? (
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      ["presentDays", "good"],
                      ["lateDays", "warn"],
                      ["absentDays", "danger"],
                      ["leaveDays", "default"],
                    ] as const
                  ).map(([key, tone]) => (
                    <div
                      key={key}
                      className="rounded-lg border border-border px-3 py-2"
                    >
                      <div
                        className={cn(
                          "text-lg font-semibold tabular-nums",
                          tone === "good" &&
                            "text-emerald-600 dark:text-emerald-400",
                          tone === "warn" &&
                            "text-amber-600 dark:text-amber-400",
                          tone === "danger" && "text-red-600 dark:text-red-400",
                        )}
                      >
                        {attendance[key]}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {t(`dashboard:attendance.${key}`)}
                      </div>
                    </div>
                  ))}
                  <div className="col-span-2 text-xs text-muted-foreground">
                    {t("dashboard:attendance.overtime", {
                      time: formatHours(attendance.overtimeMinutes * 60),
                    })}
                  </div>
                </div>
              ) : (
                <EmptyNote>{t("dashboard:loading")}</EmptyNote>
              )}
            </Section>

            <Section
              title={t("dashboard:activity.title")}
              hint={t("dashboard:activity.hint")}
              to={`${base}/reports?tab=activity`}
              linkLabel={t("dashboard:seeAll")}
              className="max-h-[28rem]"
            >
              <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
                {query && (
                  <ActivityFeed
                    query={query}
                    locale={locale}
                    timeZone={timeZone}
                  />
                )}
              </div>
            </Section>
          </div>
        </div>
      </WorkspaceLayout>
    </>
  );
}

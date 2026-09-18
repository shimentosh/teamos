import { differenceInCalendarDays, isBefore, startOfToday } from "date-fns";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import type Task from "@/types/task";

export const LIST_FILTERS = [
  "all",
  "mine",
  "overdue",
  "week",
  "urgent",
  "unassigned",
] as const;
export type ListFilter = (typeof LIST_FILTERS)[number];

/** Whether a task shows under a quick filter; done tasks are never "due". */
export function matchesListFilter(
  task: Task,
  filter: ListFilter,
  userId: string | undefined,
  done: boolean,
) {
  switch (filter) {
    case "all":
      return true;
    case "mine":
      return !!userId && task.userId === userId;
    case "overdue":
      return (
        !done &&
        !!task.dueDate &&
        isBefore(new Date(task.dueDate), startOfToday())
      );
    case "week":
      return (
        !done &&
        !!task.dueDate &&
        differenceInCalendarDays(new Date(task.dueDate), new Date()) <= 7
      );
    case "urgent":
      return !done && (task.priority === "urgent" || task.priority === "high");
    case "unassigned":
      return !done && !task.userId;
  }
}

export function matchesQuery(task: Task, slug: string, query: string) {
  const needle = query.trim().toLowerCase();
  return (
    !needle ||
    task.title.toLowerCase().includes(needle) ||
    `${slug}-${task.number}`.toLowerCase().includes(needle) ||
    (task.labels ?? []).some((label) =>
      label.name.toLowerCase().includes(needle),
    )
  );
}

function filterLabel(t: (key: string) => string, filter: ListFilter) {
  switch (filter) {
    case "mine":
      return t("tasks:listView.filter.mine");
    case "overdue":
      return t("tasks:listView.filter.overdue");
    case "week":
      return t("tasks:listView.filter.week");
    case "urgent":
      return t("tasks:listView.filter.urgent");
    case "unassigned":
      return t("tasks:listView.filter.unassigned");
    default:
      return t("tasks:listView.filter.all");
  }
}

// Quick views and search above the list, like the My work table.
export function ListToolbar({
  filter,
  onFilter,
  counts,
  query,
  onQuery,
}: {
  filter: ListFilter;
  onFilter: (filter: ListFilter) => void;
  counts: Record<ListFilter, number>;
  query: string;
  onQuery: (query: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-2 border-border/60 border-b bg-background px-4 py-2">
      <div
        role="tablist"
        aria-label={t("tasks:listView.filtersLabel")}
        className="flex flex-wrap items-center gap-1 rounded-lg bg-muted/50 p-1"
      >
        {LIST_FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={filter === value}
            onClick={() => onFilter(value)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors",
              filter === value
                ? "bg-background font-medium text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {filterLabel(t, value)}
            <span
              className={cn(
                "rounded px-1 tabular-nums",
                value === "overdue" && counts[value] > 0
                  ? "bg-destructive/15 text-destructive"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {counts[value]}
            </span>
          </button>
        ))}
      </div>
      <div className="relative ms-auto w-full sm:w-56">
        <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 size-3.5 text-muted-foreground" />
        <Input
          size="sm"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={t("tasks:listView.search")}
          aria-label={t("tasks:listView.search")}
          className="pl-7"
        />
      </div>
    </div>
  );
}

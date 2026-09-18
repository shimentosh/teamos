import { isBefore, isToday, startOfToday } from "date-fns";
import { Check } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { TimerHint } from "@/components/task/timer-hint";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/cn";
import { getColumnIcon, getStatusPillClass } from "@/lib/column";
import { formatDateShort } from "@/lib/format";
import { getInitials } from "@/lib/get-initials";
import { getPriorityLabel, getStatusDisplayLabel } from "@/lib/i18n/domain";
import { getPriorityIcon } from "@/lib/priority";
import resolveAvatarSrc from "@/lib/resolve-avatar-src";
import type { ProjectWithTasks } from "@/types/project";

// Shared by the header and every row so the columns line up.
export const LIST_GRID =
  "grid grid-cols-[4.5rem_minmax(0,1fr)_8.5rem_7rem_9rem_6rem] items-center gap-x-3";

const PRIORITIES = ["urgent", "high", "medium", "low", "no-priority"] as const;

/** What the status menu needs: board columns, or backlog pseudo-columns. */
export type StatusOption = Pick<
  ProjectWithTasks["columns"][number],
  "id" | "slug" | "name" | "isFinal" | "icon"
>;
type Column = StatusOption;

const menuItem =
  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent";
const cellTrigger =
  "inline-flex max-w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-xs transition-colors hover:bg-accent";

// Interactive cells sit inside a clickable, draggable row.
const stop = (event: React.SyntheticEvent) => event.stopPropagation();

export function StatusCell({
  status,
  columns,
  canEdit,
  onPick,
}: {
  status: string;
  columns: Column[];
  canEdit: boolean;
  onPick: (column: Column) => void;
}) {
  const [open, setOpen] = useState(false);
  const column = columns.find((c) => c.slug === status || c.id === status);
  const done = column?.isFinal ?? false;
  const pill = cn(
    "inline-flex max-w-full items-center gap-1.5 rounded-full py-0.5 ps-1 pe-2.5 text-xs transition-[filter] hover:brightness-125",
    getStatusPillClass(status, done, column?.icon),
  );
  const content = (
    <>
      {getColumnIcon(status, done, column?.icon)}
      <span className="truncate font-medium">
        {getStatusDisplayLabel(status, column?.name)}
      </span>
    </>
  );
  if (!canEdit) return <span className={pill}>{content}</span>;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: only stops the row's click
    <span onClick={stop} onPointerDown={stop} onKeyDown={stop}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger render={<button type="button" className={pill} />}>
          {content}
        </PopoverTrigger>
        <PopoverContent className="w-48 p-1" align="start">
          <ul>
            {columns.map((option) => (
              <li key={option.id}>
                <button
                  type="button"
                  className={menuItem}
                  onClick={() => {
                    setOpen(false);
                    if (option.slug !== status) onPick(option);
                  }}
                >
                  {getColumnIcon(option.slug, option.isFinal, option.icon)}
                  <span className="flex-1 truncate">
                    {getStatusDisplayLabel(option.slug, option.name)}
                  </span>
                  <TimerHint slug={option.slug} current={status} />
                  {option.slug === status && <Check className="size-3.5" />}
                </button>
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>
    </span>
  );
}

export function PriorityCell({
  priority,
  canEdit,
  onPick,
}: {
  priority: string;
  canEdit: boolean;
  onPick: (priority: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const content = (
    <>
      {getPriorityIcon(priority)}
      <span
        className={cn(
          "truncate",
          priority === "urgent" && "font-medium text-destructive",
          priority === "no-priority" && "text-muted-foreground",
        )}
      >
        {getPriorityLabel(priority)}
      </span>
    </>
  );
  if (!canEdit) return <span className={cellTrigger}>{content}</span>;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: only stops the row's click
    <span onClick={stop} onPointerDown={stop} onKeyDown={stop}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={<button type="button" className={cellTrigger} />}
        >
          {content}
        </PopoverTrigger>
        <PopoverContent className="w-44 p-1" align="start">
          <ul>
            {PRIORITIES.map((option) => (
              <li key={option}>
                <button
                  type="button"
                  className={menuItem}
                  onClick={() => {
                    setOpen(false);
                    if (option !== priority) onPick(option);
                  }}
                >
                  {getPriorityIcon(option)}
                  <span className="flex-1">{getPriorityLabel(option)}</span>
                  {option === priority && <Check className="size-3.5" />}
                </button>
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>
    </span>
  );
}

export function AssigneeCell({
  name,
  image,
  assigned,
}: {
  name: string | null | undefined;
  image: string | null | undefined;
  assigned: boolean;
}) {
  const { t } = useTranslation();
  if (!assigned) {
    return (
      <span className="flex items-center gap-1.5 text-muted-foreground text-xs">
        <span className="flex size-5 items-center justify-center rounded-full border border-border border-dashed text-[10px]">
          ?
        </span>
        {t("tasks:assignee.unassigned")}
      </span>
    );
  }
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-xs">
      <Avatar className="size-5">
        <AvatarImage src={resolveAvatarSrc(image ?? undefined)} alt="" />
        <AvatarFallback className="text-[9px]">
          {getInitials(name)}
        </AvatarFallback>
      </Avatar>
      <span className="truncate">{name}</span>
    </span>
  );
}

export function DueChip({
  dueDate,
  done,
}: {
  dueDate: string | null;
  done: boolean;
}) {
  const { t } = useTranslation();
  if (!dueDate) return <span className="text-muted-foreground text-xs">—</span>;
  const due = new Date(dueDate);
  const state = done
    ? "done"
    : isToday(due)
      ? "today"
      : isBefore(due, startOfToday())
        ? "overdue"
        : "upcoming";
  return (
    <span
      className={cn(
        "inline-flex rounded-md px-1.5 py-0.5 text-xs tabular-nums",
        state === "overdue" && "bg-destructive/15 text-destructive",
        state === "today" && "bg-warning/15 text-warning-foreground",
        (state === "upcoming" || state === "done") && "text-muted-foreground",
      )}
    >
      {state === "today" ? t("tasks:listView.today") : formatDateShort(dueDate)}
    </span>
  );
}

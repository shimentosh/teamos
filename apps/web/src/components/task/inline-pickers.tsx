import { addDays, nextMonday, startOfToday } from "date-fns";
import { Check, Search, UserX, X } from "lucide-react";
import { type ReactElement, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/components/providers/auth-provider/hooks/use-auth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";
import { cn } from "@/lib/cn";
import { formatDateShort } from "@/lib/format";
import { getInitials } from "@/lib/get-initials";
import resolveAvatarSrc from "@/lib/resolve-avatar-src";

// Rows around these pickers open the task on click and drag on pointer
// down; the picker's own clicks must not reach them.
const stop = (event: React.SyntheticEvent) => event.stopPropagation();

const option =
  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent";

/**
 * Click the trigger to pick who does a task: search, "Me", or nobody. The
 * caller saves; `onPick` gets the user id, or null for unassigned.
 */
export function AssigneePicker({
  workspaceId,
  value,
  canEdit,
  onPick,
  trigger,
}: {
  workspaceId: string;
  value: string | null;
  canEdit: boolean;
  onPick: (userId: string | null) => void;
  trigger: ReactElement;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const { data } = useGetActiveWorkspaceUsers(workspaceId);
  const needle = search.trim().toLowerCase();
  const people = useMemo(
    () =>
      (data?.members ?? [])
        .filter(
          (m) =>
            !needle ||
            m.user?.name?.toLowerCase().includes(needle) ||
            m.user?.email?.toLowerCase().includes(needle),
        )
        // You first, then everyone by name.
        .sort((a, b) =>
          a.userId === user?.id
            ? -1
            : b.userId === user?.id
              ? 1
              : (a.user?.name ?? "").localeCompare(b.user?.name ?? ""),
        ),
    [data, needle, user?.id],
  );

  if (!canEdit) return trigger;

  const pick = (userId: string | null) => {
    setOpen(false);
    setSearch("");
    if (userId !== value) onPick(userId);
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: only stops the row's click
    <span onClick={stop} onPointerDown={stop} onKeyDown={stop}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger render={trigger} />
        <PopoverContent className="w-60 p-1" align="start">
          <div className="relative mb-1">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("tasks:inline.searchPeople")}
              aria-label={t("tasks:inline.searchPeople")}
              className="h-8 ps-7 text-sm"
            />
          </div>
          <ul className="max-h-64 overflow-y-auto">
            {!needle && (
              <li>
                <button
                  type="button"
                  onClick={() => pick(null)}
                  className={cn(option, "text-muted-foreground")}
                >
                  <UserX className="size-4" />
                  <span className="flex-1">
                    {t("tasks:assignee.unassigned")}
                  </span>
                  {value === null && <Check className="size-3.5" />}
                </button>
              </li>
            )}
            {people.map((m) => (
              <li key={m.userId}>
                <button
                  type="button"
                  onClick={() => pick(m.userId)}
                  className={option}
                >
                  <Avatar className="size-5">
                    <AvatarImage
                      src={resolveAvatarSrc(m.user?.image ?? undefined)}
                      alt=""
                    />
                    <AvatarFallback className="text-[9px]">
                      {getInitials(m.user?.name)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1 truncate">
                    {m.user?.name}
                    {m.userId === user?.id && (
                      <span className="ms-1 text-muted-foreground text-xs">
                        {t("tasks:inline.me")}
                      </span>
                    )}
                  </span>
                  {value === m.userId && <Check className="size-3.5" />}
                </button>
              </li>
            ))}
            {people.length === 0 && (
              <li className="px-2 py-2 text-muted-foreground text-xs">
                {t("tasks:inline.noPeople")}
              </li>
            )}
          </ul>
        </PopoverContent>
      </Popover>
    </span>
  );
}

/**
 * Click the trigger to set a due date: quick picks for the usual choices, a
 * calendar for the rest, or clear it. `onPick` gets an ISO string or null.
 */
export function DueDatePicker({
  value,
  canEdit,
  onPick,
  trigger,
  notBefore,
}: {
  value: string | null;
  canEdit: boolean;
  onPick: (dueDate: string | null) => void;
  trigger: ReactElement;
  notBefore?: string | null;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (!canEdit) return trigger;

  const pick = (date: Date | null) => {
    setOpen(false);
    onPick(date ? date.toISOString() : null);
  };
  const today = startOfToday();
  const quick = [
    { key: "today", date: today },
    { key: "tomorrow", date: addDays(today, 1) },
    { key: "nextWeek", date: nextMonday(today) },
  ] as const;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: only stops the row's click
    <span onClick={stop} onPointerDown={stop} onKeyDown={stop}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger render={trigger} />
        <PopoverContent className="w-auto p-0" align="start">
          <div className="flex flex-wrap gap-1 border-border border-b p-2">
            {quick.map((q) => (
              <button
                key={q.key}
                type="button"
                onClick={() => pick(q.date)}
                className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
              >
                {t(`tasks:inline.due.${q.key}`)}
                <span className="ms-1 text-muted-foreground">
                  {formatDateShort(q.date)}
                </span>
              </button>
            ))}
          </div>
          <Calendar
            mode="single"
            selected={value ? new Date(value) : undefined}
            onSelect={(date) => pick(date ?? null)}
            disabled={notBefore ? { before: new Date(notBefore) } : undefined}
            className="bg-popover"
          />
          {value && (
            <div className="border-border border-t p-1">
              <button
                type="button"
                onClick={() => pick(null)}
                className={cn(option, "text-muted-foreground")}
              >
                <X className="size-4" />
                {t("tasks:popover.dueDate.clear")}
              </button>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </span>
  );
}

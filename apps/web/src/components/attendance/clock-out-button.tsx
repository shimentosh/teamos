import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/components/providers/auth-provider/hooks/use-auth";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { useClockOut } from "@/hooks/mutations/attendance/use-attendance-mutations";
import useCompanySettings from "@/hooks/queries/company/use-company-settings";
import useListTimeEntries from "@/hooks/queries/time-entry/use-list-time-entries";
import { formatHours } from "@/lib/format-duration";
import { entrySeconds } from "@/lib/timesheet";
import { toast } from "@/lib/toast";
import { zonedDay, zonedInstant } from "@/lib/zoned-time";

const MAX_NOTE = 500;

// Clocking out asks what the day went into. The note is optional: an empty
// box still clocks out. Tasks with time tracked today are one click away.
export function ClockOutButton({
  workspaceId,
  size = "xs",
  className,
  children,
}: {
  workspaceId: string;
  size?: "xs" | "sm" | "lg";
  className?: string;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const clockOut = useClockOut(workspaceId);
  const { data: company } = useCompanySettings(workspaceId);
  const timeZone = company?.timezone ?? "UTC";

  const query = useMemo(() => {
    if (!open || !user?.id) return null;
    const today = zonedDay(new Date(), timeZone);
    return {
      workspaceId,
      userId: user.id,
      from: zonedInstant(today, "00:00", timeZone).toISOString(),
      to: zonedInstant(today, "23:59", timeZone).toISOString(),
    };
  }, [open, user?.id, workspaceId, timeZone]);
  const { data: entries = [] } = useListTimeEntries(query);

  // One suggestion per task, with the time tracked on it today.
  const worked = useMemo(() => {
    const now = new Date();
    const byTask = new Map<string, { label: string; seconds: number }>();
    for (const entry of entries) {
      const ref =
        entry.taskNumber !== null
          ? `${entry.projectSlug}-${entry.taskNumber} `
          : "";
      const current = byTask.get(entry.taskId) ?? {
        label: `${ref}${entry.taskTitle}`,
        seconds: 0,
      };
      current.seconds += entrySeconds(entry, now);
      byTask.set(entry.taskId, current);
    }
    return [...byTask.values()].sort((a, b) => b.seconds - a.seconds);
  }, [entries]);

  const add = (line: string) =>
    setNote((prev) => {
      if (prev.includes(line)) return prev;
      const next = prev.trim() ? `${prev.trimEnd()}\n• ${line}` : `• ${line}`;
      return next.slice(0, MAX_NOTE);
    });

  const submit = () => {
    if (clockOut.isPending) return Promise.resolve();
    return clockOut
      .mutateAsync(note)
      .then(() => {
        setOpen(false);
        setNote("");
      })
      .catch((error) =>
        toast.error(
          error instanceof Error ? error.message : t("attendance:card.error"),
        ),
      );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button variant="outline" size={size} className={className} />}
      >
        {children}
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-3 p-3" align="start" side="top">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">
            {t("attendance:clockOutNote.title")}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("attendance:clockOutNote.hint")}
          </p>
        </div>
        <Textarea
          value={note}
          rows={4}
          maxLength={MAX_NOTE}
          autoFocus
          aria-label={t("attendance:clockOutNote.title")}
          placeholder={t("attendance:clockOutNote.placeholder")}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        {worked.length > 0 && (
          <div className="space-y-1">
            <p className="text-[11px] text-muted-foreground">
              {t("attendance:clockOutNote.trackedToday")}
            </p>
            <div className="flex flex-wrap gap-1">
              {worked.slice(0, 6).map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => add(item.label)}
                  className="inline-flex max-w-full items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-xs hover:bg-accent"
                >
                  <Plus className="size-3 shrink-0 text-muted-foreground" />
                  <span className="truncate">{item.label}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {formatHours(item.seconds)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">
            {t("attendance:clockOutNote.shortcut")}
          </span>
          <Button size="sm" onClick={submit} disabled={clockOut.isPending}>
            {t("attendance:card.clockOut")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

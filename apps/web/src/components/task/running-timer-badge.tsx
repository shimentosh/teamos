import { useTranslation } from "react-i18next";
import useRunningTimeEntry from "@/hooks/queries/time-entry/use-running-time-entry";
import { useNow } from "@/hooks/use-now";
import { formatClock } from "@/lib/format-duration";

/**
 * "● 12:34" next to the task your timer is running on, so it's obvious in a
 * list which task is being tracked right now.
 */
export function RunningTimerBadge({
  taskId,
  workspaceId,
}: {
  taskId: string;
  workspaceId: string;
}) {
  const { t } = useTranslation();
  const { data: running } = useRunningTimeEntry(workspaceId);
  const active = running?.taskId === taskId;
  const now = useNow(active);
  if (!active || !running) return null;
  const seconds = Math.max(
    0,
    Math.floor((now.getTime() - new Date(running.startTime).getTime()) / 1000),
  );
  return (
    <span
      className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-px font-medium text-[11px] text-emerald-700 tabular-nums dark:text-emerald-400"
      title={t("time:auto.running")}
    >
      <span className="relative flex size-1.5">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60 motion-reduce:hidden" />
        <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
      </span>
      {formatClock(seconds)}
    </span>
  );
}

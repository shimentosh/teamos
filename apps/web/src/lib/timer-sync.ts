import type { QueryClient } from "@tanstack/react-query";
import i18n from "i18next";
import { toast } from "@/lib/toast";
import { useTimerNoteStore } from "@/store/timer-note";

type Running = {
  id: string;
  taskTitle?: string | null;
  startTime: string;
} | null;

const RUNNING = ["time-entries", "running"];

/**
 * A status change can start or stop the timer on the server (In Progress
 * starts it, leaving In Progress stops it). Refresh the timer views and say
 * what happened, so tracking never changes silently; a stopped timer asks
 * what was done.
 */
export async function syncTimerAfterStatusChange(queryClient: QueryClient) {
  const before = queryClient.getQueriesData<Running>({ queryKey: RUNNING });
  // Also refreshes each task's time log.
  await queryClient.invalidateQueries({ queryKey: ["time-entries"] });

  for (const [key, previous] of before) {
    const current = queryClient.getQueryData<Running>(key) ?? null;
    const was = previous ?? null;
    if (was?.id === current?.id) continue;

    // Stopped, or switched to another task: note the one that ended.
    if (was) {
      const seconds = Math.max(
        0,
        Math.round((Date.now() - new Date(was.startTime).getTime()) / 1000),
      );
      useTimerNoteStore.getState().ask({
        entryId: was.id,
        taskTitle: was.taskTitle ?? "",
        seconds,
      });
    }
    if (current) {
      toast.success(
        i18n.t("time:auto.started", { task: current.taskTitle ?? "" }),
        { description: i18n.t("time:auto.startedHint") },
      );
    }
  }
}

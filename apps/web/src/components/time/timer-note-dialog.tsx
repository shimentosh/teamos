import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Timer } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import updateTimeEntryNote from "@/fetchers/time-entry/update-time-entry-note";
import { formatDuration } from "@/lib/format-duration";
import { toast } from "@/lib/toast";
import { useTimerNoteStore } from "@/store/timer-note";
import { type TimeNote, TimeNoteFields } from "./time-note-fields";

const EMPTY: TimeNote = { note: "", reference: "" };

/** Asks what was done once a status change stops the timer. Skipping is fine. */
export function TimerNoteDialog() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { stopped, close } = useTimerNoteStore();
  const [value, setValue] = useState(EMPTY);

  // Each stopped timer starts with empty fields.
  useEffect(() => {
    if (stopped) setValue(EMPTY);
  }, [stopped]);

  const save = useMutation({
    mutationFn: (entryId: string) =>
      updateTimeEntryNote(entryId, {
        description: value.note.trim() || undefined,
        reference: value.reference.trim() || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["time-entries"] });
      toast.success(t("time:note.saved"));
      close();
    },
    onError: (error) => toast.error(error.message || t("time:note.failed")),
  });

  const submit = () => {
    if (!stopped || save.isPending) return;
    if (!value.note.trim() && !value.reference.trim()) return close();
    save.mutate(stopped.entryId);
  };

  return (
    <Dialog open={!!stopped} onOpenChange={(open) => !open && close()}>
      <DialogPopup className="w-full max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Timer className="size-4 text-muted-foreground" />
            {t("time:task.whatDidYouDo")}
          </DialogTitle>
          {stopped && (
            <DialogDescription>
              {t("time:note.subtitle", {
                duration: formatDuration(stopped.seconds),
                task: stopped.taskTitle,
              })}
            </DialogDescription>
          )}
        </DialogHeader>
        <DialogPanel>
          <TimeNoteFields value={value} onChange={setValue} onSubmit={submit} />
        </DialogPanel>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={close}>
            {t("time:note.skip")}
          </Button>
          <Button size="sm" onClick={submit} disabled={save.isPending}>
            {t("time:note.save")}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

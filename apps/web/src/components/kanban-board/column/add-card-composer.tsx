import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import useCreateTask from "@/hooks/mutations/task/use-create-task";
import { toast } from "@/lib/toast";

type AddCardComposerProps = {
  projectId: string;
  status: string;
  onClose: () => void;
};

export function AddCardComposer({
  projectId,
  status,
  onClose,
}: AddCardComposerProps) {
  const { t } = useTranslation();
  const [title, setTitle] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { mutateAsync: createTask, isPending } = useCreateTask();

  useEffect(() => {
    textareaRef.current?.focus();
    textareaRef.current?.scrollIntoView({ block: "nearest" });
  }, []);

  const submit = async () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle || isPending) return;

    try {
      await createTask({
        title: trimmedTitle,
        description: "",
        projectId,
        status,
        priority: "no-priority",
      });

      // Trello keeps the composer open after a card lands so several cards can
      // be typed in a row; the refetched board is what renders the new card.
      setTitle("");
      textareaRef.current?.focus();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("tasks:kanban.addCardError"),
      );
    }
  };

  return (
    <div className="rounded-lg border border-ring/40 bg-background p-2 shadow-sm ring-1 ring-ring/20">
      <textarea
        ref={textareaRef}
        value={title}
        rows={2}
        placeholder={t("tasks:kanban.addCardPlaceholder")}
        aria-label={t("tasks:kanban.addCardPlaceholder")}
        onChange={(event) => setTitle(event.target.value)}
        onBlur={() => {
          // An empty composer closes itself on click-away; a typed one stays so
          // the Add and cancel buttons survive the blur that precedes their click.
          if (!title.trim()) onClose();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void submit();
            return;
          }

          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
        className="w-full resize-none bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
      />

      <div className="mt-2 flex items-center gap-1">
        <Button
          type="button"
          size="sm"
          loading={isPending}
          disabled={!title.trim()}
          onClick={() => void submit()}
        >
          {t("tasks:kanban.addCardSubmit")}
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={t("common:actions.cancel")}
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

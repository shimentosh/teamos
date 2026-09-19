import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import {
  Check,
  Loader2,
  MessageSquare,
  PencilLine,
  Plus,
  Sparkles,
  Undo2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { type AiChangeSet, aiApi } from "@/fetchers/ai";
import useGetTask from "@/hooks/queries/task/use-get-task";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { cn } from "@/lib/cn";
import { formatDateShort } from "@/lib/format";
import { toast } from "@/lib/toast";

type Action = Record<string, unknown> & { type: string };

const FIELD_ORDER = ["title", "status", "priority", "assigneeId", "dueDate"];

function TaskName({ taskId }: { taskId: string }) {
  const { data } = useGetTask(taskId);
  if (!data) return <span className="text-muted-foreground">…</span>;
  return <span className="font-medium">{data.title}</span>;
}

function ActionCard({
  action,
  checked,
  onToggle,
  result,
  disabled,
}: {
  action: Action;
  checked: boolean;
  onToggle: () => void;
  result?: Record<string, unknown>;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const Icon =
    action.type === "create_task"
      ? Plus
      : action.type === "comment"
        ? MessageSquare
        : PencilLine;
  const fields = FIELD_ORDER.filter((f) => f in action);
  const show = (field: string, value: unknown) => {
    if (value === null) return t("ai:ask.cleared");
    if (field === "dueDate" && typeof value === "string")
      return formatDateShort(value);
    return String(value);
  };
  return (
    <li
      className={cn(
        "flex gap-3 rounded-lg border p-3 text-sm",
        checked ? "border-primary/40 bg-primary/5" : "border-border opacity-70",
      )}
    >
      <input
        type="checkbox"
        className="mt-1"
        checked={checked}
        disabled={disabled}
        onChange={onToggle}
        aria-label={t("ai:ask.include")}
      />
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-1">
        {action.type === "create_task" && (
          <p>
            {t("ai:ask.create")}{" "}
            <span className="font-medium">{String(action.title)}</span>
          </p>
        )}
        {action.type === "update_task" && (
          <p>
            {t("ai:ask.update")} <TaskName taskId={String(action.taskId)} />
          </p>
        )}
        {action.type === "comment" && (
          <p>
            {t("ai:ask.comment")} <TaskName taskId={String(action.taskId)} />
            <span className="mt-1 block rounded bg-muted px-2 py-1 text-xs">
              {String(action.body)}
            </span>
          </p>
        )}
        {fields.length > 0 && action.type !== "comment" && (
          <p className="flex flex-wrap gap-1.5 text-xs">
            {fields.map((field) => (
              <span
                key={field}
                className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground"
              >
                {t(`ai:ask.fields.${field}`)}: {show(field, action[field])}
              </span>
            ))}
          </p>
        )}
        {typeof action.reason === "string" && (
          <p className="text-xs text-muted-foreground">{action.reason}</p>
        )}
        {result && (
          <p
            className={cn(
              "text-xs",
              result.ok
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-destructive",
            )}
          >
            {result.ok ? t("ai:ask.done") : String(result.error)}
          </p>
        )}
      </div>
    </li>
  );
}

const OPEN_EVENT = "teamos:open-change-set";

/** Opens the Ask TeamOS panel on a change set, e.g. a teammate's run. */
export function openChangeSet(id: string) {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id }));
}

function useChangeSet(workspaceId: string | undefined, id: string | null) {
  return useQuery({
    queryKey: ["ai", "change-set", id],
    queryFn: () => aiApi.changeSet(workspaceId as string, id as string),
    enabled: !!workspaceId && !!id,
    refetchInterval: (query) =>
      query.state.data?.status === "proposing" ? 1500 : false,
  });
}

/** The ✦ button in the sidebar header, plus Ctrl/⌘+J anywhere. */
export function AskTeamOsButton({
  hideTrigger = false,
}: {
  /** Pages without the sidebar mount the panel alone, to open results. */
  hideTrigger?: boolean;
} = {}) {
  const { t } = useTranslation();
  const { data: workspace } = useActiveWorkspace();
  const params = useParams({ strict: false }) as {
    projectId?: string;
    taskId?: string;
  };
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [id, setId] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const { data: changeSet } = useChangeSet(workspace?.id, id);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j") {
        event.preventDefault();
        setOpen((v) => !v);
      }
    };
    const onOpen = (event: Event) => {
      const next = (event as CustomEvent<string>).detail;
      if (!next) return;
      setId(next);
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);

  // Every proposed action starts ticked.
  useEffect(() => {
    if (changeSet?.status === "proposed") {
      setPicked(new Set((changeSet.actions ?? []).map((_, i) => i)));
    }
  }, [changeSet?.status, changeSet?.actions]);

  if (!workspace) return null;

  const run = async (fn: () => Promise<AiChangeSet>, success?: string) => {
    setBusy(true);
    try {
      const next = await fn();
      queryClient.setQueryData(["ai", "change-set", next.id], next);
      // Tasks changed under the page; refresh everything that shows them.
      await queryClient.invalidateQueries();
      if (success) toast.success(success);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("ai:error"));
    } finally {
      setBusy(false);
    }
  };

  const ask = async () => {
    if (!prompt.trim()) return;
    setBusy(true);
    try {
      const started = await aiApi.ask({
        workspaceId: workspace.id,
        prompt: prompt.trim(),
        context: {
          projectId: params.projectId,
          taskId: params.taskId,
          page: window.location.pathname,
        },
      });
      setId(started.id);
      queryClient.setQueryData(["ai", "change-set", started.id], started);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("ai:error"));
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setId(null);
    setPrompt("");
    setPicked(new Set());
  };

  const actions = (changeSet?.actions ?? []) as Action[];
  const results = new Map(
    ((changeSet?.results ?? []) as Record<string, unknown>[]).map((r) => [
      Number(r.index),
      r,
    ]),
  );
  const status = changeSet?.status;

  return (
    <>
      {!hideTrigger && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("ai:ask.open")}
          title={`${t("ai:ask.open")} (Ctrl+J)`}
          onClick={() => setOpen(true)}
        >
          <Sparkles className="h-4 w-4" />
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPopup className="w-full max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="size-4" />
              {t("ai:ask.title")}
            </DialogTitle>
          </DialogHeader>
          <DialogPanel className="space-y-4">
            {!id && (
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void ask();
                }}
              >
                <Textarea
                  autoFocus
                  rows={4}
                  value={prompt}
                  maxLength={8000}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      void ask();
                    }
                  }}
                  placeholder={t("ai:ask.placeholder")}
                  aria-label={t("ai:ask.title")}
                />
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    {params.taskId
                      ? t("ai:ask.contextTask")
                      : params.projectId
                        ? t("ai:ask.contextProject")
                        : t("ai:ask.contextWorkspace", {
                            name: workspace.name,
                          })}
                  </p>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={busy || !prompt.trim()}
                  >
                    {t("ai:ask.send")}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("ai:ask.safety")}
                </p>
              </form>
            )}

            {id && (
              <div className="space-y-3">
                <p className="rounded-md bg-muted/60 px-3 py-2 text-sm">
                  {changeSet?.prompt ?? prompt}
                </p>

                {status === "proposing" && (
                  <div className="space-y-2">
                    <p className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" />
                      {t("ai:ask.working")}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {(changeSet?.progress ?? []).map((step, i) => (
                        <span
                          // biome-ignore lint/suspicious/noArrayIndexKey: steps repeat by name
                          key={`${step}-${i}`}
                          className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                        >
                          {step.replace(/_/g, " ")}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {status === "failed" && (
                  <p className="text-sm text-destructive">{changeSet?.error}</p>
                )}

                {changeSet?.summary && status !== "proposing" && (
                  <p className="whitespace-pre-wrap text-sm">
                    {changeSet.summary}
                  </p>
                )}

                {actions.length > 0 && (
                  <ul className="max-h-[45vh] space-y-2 overflow-y-auto pe-1">
                    {actions.map((action, i) => (
                      <ActionCard
                        // biome-ignore lint/suspicious/noArrayIndexKey: actions are positional
                        key={i}
                        action={action}
                        checked={picked.has(i)}
                        disabled={status !== "proposed"}
                        result={results.get(i)}
                        onToggle={() =>
                          setPicked((set) => {
                            const next = new Set(set);
                            if (next.has(i)) next.delete(i);
                            else next.add(i);
                            return next;
                          })
                        }
                      />
                    ))}
                  </ul>
                )}

                {status && status !== "proposing" && (
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {status === "proposed" && actions.length > 0 && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            run(() => aiApi.discard(workspace.id, id)).then(
                              reset,
                            )
                          }
                        >
                          <X className="size-3.5" />
                          {t("ai:ask.discard")}
                        </Button>
                        <Button
                          size="sm"
                          disabled={busy || picked.size === 0}
                          onClick={() =>
                            run(
                              () => aiApi.apply(workspace.id, id, [...picked]),
                              t("ai:ask.applied"),
                            )
                          }
                        >
                          <Check className="size-3.5" />
                          {t("ai:ask.apply", { count: picked.size })}
                        </Button>
                      </>
                    )}
                    {status === "applied" && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          run(
                            () => aiApi.undo(workspace.id, id),
                            t("ai:ask.undone"),
                          )
                        }
                      >
                        <Undo2 className="size-3.5" />
                        {t("ai:ask.undo")}
                      </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={reset}>
                      {t("ai:ask.newRequest")}
                    </Button>
                  </div>
                )}
              </div>
            )}

            <p className="border-t border-border pt-3 text-xs text-muted-foreground">
              <Link
                to="/dashboard/settings/account/ai"
                className="underline"
                onClick={() => setOpen(false)}
              >
                {t("ai:ask.settingsLink")}
              </Link>
            </p>
          </DialogPanel>
        </DialogPopup>
      </Dialog>
    </>
  );
}

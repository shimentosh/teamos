import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFrame,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { type AiTeammate, aiApi } from "@/fetchers/ai";
import { useChatConversations } from "@/hooks/chat";
import { cn } from "@/lib/cn";
import { formatRelativeTime } from "@/lib/format";
import { toast } from "@/lib/toast";
import { openChangeSet } from "./ask-teamos";
import { useSettingsWorkspace } from "./use-settings-workspace";

const DAYS = [1, 2, 3, 4, 5, 6, 7] as const;
const POSTS: AiTeammate["kind"][] = ["standup", "weekly"];

function TeammateCard({
  workspaceId,
  teammate,
}: {
  workspaceId: string;
  teammate: AiTeammate;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(teammate);
  useEffect(() => setDraft(teammate), [teammate]);
  const { data: conversations = [] } = useChatConversations(
    POSTS.includes(teammate.kind) ? workspaceId : undefined,
  );
  const channels = conversations.filter(
    (c) => c.type === "channel" && c.joined,
  );

  const save = useMutation({
    mutationFn: (next: AiTeammate) =>
      aiApi.saveTeammate(workspaceId, next.kind, {
        enabled: next.enabled,
        instructions: next.instructions,
        time: next.time,
        days: next.days,
        mode: next.mode,
        channelId: next.channelId,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["ai", "teammates"] }),
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : t("ai:error")),
  });
  const run = useMutation({
    mutationFn: () => aiApi.runTeammate(workspaceId, teammate.kind),
    onSuccess: () => toast.success(t("ai:teammates.started")),
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : t("ai:error")),
  });

  const days = new Set(draft.days.split(",").map(Number));
  const toggleDay = (day: number) => {
    const next = new Set(days);
    if (next.has(day)) next.delete(day);
    else next.add(day);
    if (next.size === 0) return;
    setDraft({ ...draft, days: [...next].sort().join(",") });
  };
  const dirty = JSON.stringify(draft) !== JSON.stringify(teammate);

  return (
    <li className="space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">
            {t(`ai:teammates.kinds.${teammate.kind}.title`)}
          </p>
          <p className="text-xs text-muted-foreground">
            {t(`ai:teammates.kinds.${teammate.kind}.hint`)}
          </p>
        </div>
        <Switch
          checked={draft.enabled}
          aria-label={t("ai:teammates.enabled")}
          onCheckedChange={(enabled) => {
            const next = { ...draft, enabled };
            setDraft(next);
            save.mutate(next);
          }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="time"
          value={draft.time}
          onChange={(e) => setDraft({ ...draft, time: e.target.value })}
          aria-label={t("ai:teammates.time")}
          className="h-8 w-28"
        />
        <div className="flex gap-1">
          {DAYS.map((day) => (
            <button
              key={day}
              type="button"
              aria-pressed={days.has(day)}
              onClick={() => toggleDay(day)}
              className={cn(
                "size-8 rounded-md border text-xs",
                days.has(day)
                  ? "border-primary bg-primary/10 font-medium"
                  : "border-border text-muted-foreground",
              )}
            >
              {t(`ai:teammates.days.${day}`)}
            </button>
          ))}
        </div>
        <div className="ms-auto flex rounded-md border border-border p-0.5 text-xs">
          {(["suggest", "act"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={draft.mode === mode}
              onClick={() => setDraft({ ...draft, mode })}
              title={t(`ai:teammates.modes.${mode}.hint`)}
              className={cn(
                "rounded px-2 py-1",
                draft.mode === mode
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground",
              )}
            >
              {t(`ai:teammates.modes.${mode}.title`)}
            </button>
          ))}
        </div>
      </div>

      {POSTS.includes(teammate.kind) && (
        <select
          value={draft.channelId ?? ""}
          onChange={(e) =>
            setDraft({ ...draft, channelId: e.target.value || null })
          }
          aria-label={t("ai:teammates.channel")}
          className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm"
        >
          <option value="">{t("ai:teammates.noChannel")}</option>
          {channels.map((c) => (
            <option key={c.id} value={c.id}>
              #{c.name}
            </option>
          ))}
        </select>
      )}

      <Textarea
        rows={2}
        value={draft.instructions ?? ""}
        maxLength={2000}
        onChange={(e) =>
          setDraft({ ...draft, instructions: e.target.value || null })
        }
        placeholder={t("ai:teammates.instructionsPlaceholder")}
        aria-label={t("ai:teammates.instructions")}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {teammate.lastRunAt
            ? t("ai:teammates.lastRun", {
                when: formatRelativeTime(teammate.lastRunAt),
              })
            : t("ai:teammates.neverRun")}
          {teammate.lastChangeSetId && (
            <button
              type="button"
              className="ms-2 underline"
              onClick={() => openChangeSet(teammate.lastChangeSetId as string)}
            >
              {t("ai:teammates.viewResult")}
            </button>
          )}
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="xs"
            disabled={run.isPending || dirty}
            onClick={() => run.mutate()}
            className="gap-1"
          >
            <Play className="size-3" />
            {t("ai:teammates.runNow")}
          </Button>
          <Button
            size="xs"
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate(draft)}
          >
            {t("ai:teammates.save")}
          </Button>
        </div>
      </div>
    </li>
  );
}

/** Claude on a schedule, one card per teammate. */
export function TeammatesSettings() {
  const { t } = useTranslation();
  const workspace = useSettingsWorkspace();
  const { data: teammates = [] } = useQuery({
    queryKey: ["ai", "teammates", workspace?.id],
    queryFn: () => aiApi.teammates(workspace?.id as string),
    enabled: !!workspace?.id,
  });
  if (!workspace) return null;
  return (
    <CardFrame>
      <Card className="!rounded-none !border-t-0">
        <CardHeader>
          <CardTitle className="inline-flex items-center gap-2 text-base">
            <Bot className="size-4" />
            {t("ai:teammates.title")}
          </CardTitle>
          <CardDescription>{t("ai:teammates.description")}</CardDescription>
        </CardHeader>
        <CardPanel className="p-0">
          <ul className="divide-y divide-border">
            {teammates.map((teammate) => (
              <TeammateCard
                key={teammate.kind}
                workspaceId={workspace.id}
                teammate={teammate}
              />
            ))}
          </ul>
        </CardPanel>
      </Card>
    </CardFrame>
  );
}

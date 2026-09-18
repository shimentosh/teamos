import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Card,
  CardDescription,
  CardFrame,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { aiApi } from "@/fetchers/ai";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { cn } from "@/lib/cn";
import { toast } from "@/lib/toast";
import {
  useSettingsWorkspace,
  useWorkspaceChoices,
} from "./use-settings-workspace";

/** Turn Ask TeamOS on for the workspace and choose where Claude runs. */
export function WorkspaceAiSettings() {
  const { t } = useTranslation();
  const workspace = useSettingsWorkspace();
  const { organizations, choose } = useWorkspaceChoices();
  const { canManageWorkspace } = useWorkspacePermission();
  const canEdit = Boolean(canManageWorkspace());
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["ai", "settings", workspace?.id],
    queryFn: () => aiApi.settings(workspace?.id as string),
    enabled: !!workspace?.id,
  });
  const save = useMutation({
    mutationFn: (input: { enabled: boolean; engine: "server" | "desktop" }) =>
      aiApi.setSettings({ workspaceId: workspace?.id as string, ...input }),
    onSuccess: (next) =>
      queryClient.setQueryData(["ai", "settings", workspace?.id], next),
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : t("ai:error")),
  });
  if (!workspace || !data) return null;

  const engines = [
    { id: "server" as const, available: data.serverAvailable },
    { id: "desktop" as const, available: true },
  ];

  return (
    <CardFrame>
      <Card className="!rounded-none !border-t-0">
        <CardHeader>
          <CardTitle className="inline-flex items-center gap-2 text-base">
            <Sparkles className="size-4" />
            {t("ai:workspace.title", { name: workspace.name })}
          </CardTitle>
          <CardDescription>{t("ai:workspace.description")}</CardDescription>
          {organizations.length > 1 && (
            <select
              value={workspace.id}
              onChange={(e) => void choose(e.target.value)}
              aria-label={t("ai:workspace.pick")}
              className="mt-2 h-8 w-fit rounded-md border border-border bg-background px-2 text-sm"
            >
              {organizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          )}
        </CardHeader>
        <CardPanel className="space-y-4 p-4">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span>
              <span className="block font-medium">
                {t("ai:workspace.enable")}
              </span>
              <span className="block text-xs text-muted-foreground">
                {t("ai:workspace.enableHint")}
              </span>
            </span>
            <Switch
              aria-label={t("ai:workspace.enable")}
              checked={data.enabled}
              disabled={!canEdit || save.isPending}
              onCheckedChange={(enabled) =>
                save.mutate({ enabled, engine: data.engine })
              }
            />
          </div>
          <fieldset
            aria-label={t("ai:workspace.engine")}
            className="m-0 grid gap-2 border-0 p-0 sm:grid-cols-2"
          >
            {engines.map((engine) => {
              const selected = data.engine === engine.id;
              return (
                <button
                  key={engine.id}
                  type="button"
                  aria-pressed={selected}
                  disabled={!canEdit || save.isPending}
                  onClick={() =>
                    save.mutate({ enabled: data.enabled, engine: engine.id })
                  }
                  className={cn(
                    "rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed",
                    selected
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "border-border hover:bg-accent/50",
                  )}
                >
                  <span className="block text-sm font-medium">
                    {t(`ai:workspace.engines.${engine.id}.title`)}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {t(`ai:workspace.engines.${engine.id}.hint`)}
                  </span>
                  {engine.id === "server" && (
                    <span
                      className={cn(
                        "mt-1 block text-xs",
                        engine.available
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-amber-600 dark:text-amber-400",
                      )}
                    >
                      {engine.available
                        ? t("ai:workspace.serverFound")
                        : t("ai:workspace.serverMissing")}
                    </span>
                  )}
                </button>
              );
            })}
          </fieldset>
          {!canEdit && (
            <p className="text-xs text-muted-foreground">
              {t("ai:workspace.askAdmin")}
            </p>
          )}
        </CardPanel>
      </Card>
    </CardFrame>
  );
}

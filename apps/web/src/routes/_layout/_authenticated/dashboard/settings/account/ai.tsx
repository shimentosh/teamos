import { createFileRoute } from "@tanstack/react-router";
import {
  Bot,
  Check,
  Copy,
  Eye,
  KeyRound,
  ListChecks,
  ShieldAlert,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AskTeamOsButton } from "@/components/ai/ask-teamos";
import { TeammatesSettings } from "@/components/ai/teammates-settings";
import { WorkspaceAiSettings } from "@/components/ai/workspace-ai-settings";
import PageTitle from "@/components/page-title";
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
import type { AgentScope } from "@/fetchers/ai";
import {
  useAgentConnectInfo,
  useAgentKeyActions,
  useAgentKeys,
} from "@/hooks/queries/use-ai";
import { cn } from "@/lib/cn";
import { formatDateMedium, formatRelativeTime } from "@/lib/format";
import { toast } from "@/lib/toast";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/account/ai",
)({
  component: RouteComponent,
});

const SCOPES: { id: AgentScope; icon: typeof Eye }[] = [
  { id: "read", icon: Eye },
  { id: "tasks", icon: ListChecks },
  { id: "full", icon: Sparkles },
];

function CopyBlock({ label, text }: { label: string; text: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          {label}
        </span>
        <Button
          variant="ghost"
          size="xs"
          className="gap-1"
          onClick={async () => {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? (
            <Check className="size-3.5" />
          ) : (
            <Copy className="size-3.5" />
          )}
          {copied ? t("ai:copied") : t("ai:copy")}
        </Button>
      </div>
      <pre className="overflow-x-auto rounded-md border border-border bg-muted/50 p-3 text-xs leading-relaxed">
        <code>{text}</code>
      </pre>
    </div>
  );
}

function RouteComponent() {
  const { t } = useTranslation();
  const { data: info } = useAgentConnectInfo();
  const { data: keys = [], isLoading } = useAgentKeys();
  const { create, revoke, revokeAll } = useAgentKeyActions();
  const [scope, setScope] = useState<AgentScope>("tasks");
  const [name, setName] = useState("");
  const [created, setCreated] = useState<{
    key: string;
    scope: AgentScope;
  } | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const mcpUrl = info?.mcpUrl ?? "";

  const act = (fn: () => Promise<unknown>, success?: string) =>
    fn()
      .then(() => success && toast.success(success))
      .catch((error) =>
        toast.error(error instanceof Error ? error.message : t("ai:error")),
      );

  const make = () =>
    act(async () => {
      const key = await create.mutateAsync({
        scope,
        name: name.trim() || undefined,
      });
      setCreated({ key: key.key, scope: key.scope });
      setName("");
    });

  const claudeCode = created
    ? `claude mcp add --transport http teamos ${mcpUrl} \\\n  --header "Authorization: Bearer ${created.key}"`
    : "";
  const mcpJson = created
    ? JSON.stringify(
        {
          mcpServers: {
            teamos: {
              type: "http",
              url: mcpUrl,
              headers: { Authorization: `Bearer ${created.key}` },
            },
          },
        },
        null,
        2,
      )
    : "";

  return (
    <>
      <PageTitle title={t("ai:pageTitle")} />
      <div className="mx-auto max-w-4xl space-y-8">
        <div className="space-y-2">
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Bot className="size-6" />
            {t("ai:title")}
          </h1>
          <p className="text-muted-foreground">{t("ai:subtitle")}</p>
        </div>

        <WorkspaceAiSettings />

        <TeammatesSettings />
        <AskTeamOsButton hideTrigger />

        <CardFrame>
          <Card className="!rounded-none !border-t-0">
            <CardHeader>
              <CardTitle className="inline-flex items-center gap-2 text-base">
                <Sparkles className="size-4" />
                {t("ai:connect.title")}
              </CardTitle>
              <CardDescription>{t("ai:connect.description")}</CardDescription>
            </CardHeader>
            <CardPanel className="space-y-4 p-4">
              <fieldset
                aria-label={t("ai:scope.label")}
                className="m-0 grid gap-2 border-0 p-0 sm:grid-cols-3"
              >
                {SCOPES.map((s) => {
                  const Icon = s.icon;
                  const selected = scope === s.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setScope(s.id)}
                      className={cn(
                        "flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors",
                        selected
                          ? "border-primary bg-primary/5 ring-1 ring-primary"
                          : "border-border hover:bg-accent/50",
                      )}
                    >
                      <span className="flex items-center gap-2 text-sm font-medium">
                        <Icon className="size-4" />
                        {t(`ai:scope.${s.id}.title`)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {t(`ai:scope.${s.id}.hint`)}
                      </span>
                    </button>
                  );
                })}
              </fieldset>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void make();
                }}
              >
                <Input
                  value={name}
                  maxLength={60}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("ai:connect.namePlaceholder")}
                  aria-label={t("ai:connect.name")}
                />
                <Button
                  type="submit"
                  disabled={create.isPending}
                  className="gap-2"
                >
                  <KeyRound className="size-4" />
                  {t("ai:connect.create")}
                </Button>
              </form>

              {created && (
                <div className="space-y-3 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-4">
                  <p className="text-sm font-medium">
                    {t("ai:connect.readyTitle")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("ai:connect.readyHint")}
                  </p>
                  <CopyBlock
                    label={t("ai:connect.claudeCode")}
                    text={claudeCode}
                  />
                  <CopyBlock label={t("ai:connect.otherApps")} text={mcpJson} />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCreated(null)}
                  >
                    {t("ai:connect.done")}
                  </Button>
                </div>
              )}

              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground">
                  {t("ai:connect.oauthTitle")}
                </summary>
                <div className="mt-3 space-y-2">
                  <p className="text-xs text-muted-foreground">
                    {t("ai:connect.oauthHint")}
                  </p>
                  <CopyBlock
                    label={t("ai:connect.claudeCode")}
                    text={`claude mcp add --transport http teamos ${mcpUrl}`}
                  />
                </div>
              </details>
            </CardPanel>
          </Card>
        </CardFrame>

        <CardFrame>
          <Card className="!rounded-none !border-t-0">
            <CardHeader>
              <CardTitle className="inline-flex items-center gap-2 text-base">
                <KeyRound className="size-4" />
                {t("ai:keys.title")}
              </CardTitle>
              <CardDescription>{t("ai:keys.description")}</CardDescription>
            </CardHeader>
            <CardPanel className="p-0">
              {isLoading ? null : keys.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                  {t("ai:keys.none")}
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {keys.map((key) => (
                    <li
                      key={key.id}
                      className="flex items-center gap-3 px-4 py-3"
                    >
                      <Bot className="size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {key.name}
                          <span className="ms-2 rounded bg-muted px-1.5 py-0.5 text-[11px] font-normal">
                            {t(`ai:scope.${key.scope}.title`)}
                          </span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {key.start ? `${key.start}… · ` : ""}
                          {key.lastUsedAt
                            ? t("ai:keys.lastUsed", {
                                when: formatRelativeTime(key.lastUsedAt),
                              })
                            : t("ai:keys.neverUsed")}
                          {" · "}
                          {t("ai:keys.created", {
                            when: formatDateMedium(key.createdAt),
                          })}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("ai:keys.revoke", { name: key.name })}
                        title={t("ai:keys.revoke", { name: key.name })}
                        disabled={revoke.isPending}
                        onClick={() =>
                          act(
                            () => revoke.mutateAsync(key.id),
                            t("ai:keys.revoked"),
                          )
                        }
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardPanel>
          </Card>
          {keys.length > 0 && (
            <Card className="!rounded-none">
              <CardPanel className="flex items-center justify-between gap-3 p-4">
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  <ShieldAlert className="size-4" />
                  {t("ai:keys.killSwitchHint")}
                </span>
                <Button
                  variant={confirmAll ? "destructive" : "outline"}
                  size="sm"
                  disabled={revokeAll.isPending}
                  onClick={() => {
                    if (!confirmAll) {
                      setConfirmAll(true);
                      setTimeout(() => setConfirmAll(false), 4000);
                      return;
                    }
                    setConfirmAll(false);
                    void act(
                      () => revokeAll.mutateAsync(),
                      t("ai:keys.allRevoked"),
                    );
                  }}
                >
                  {confirmAll
                    ? t("ai:keys.confirmAll")
                    : t("ai:keys.revokeAll")}
                </Button>
              </CardPanel>
            </Card>
          )}
        </CardFrame>

        <CardFrame>
          <Card className="!rounded-none !border-t-0">
            <CardHeader>
              <CardTitle className="inline-flex items-center gap-2 text-base">
                <Bot className="size-4" />
                {t("ai:try.title")}
              </CardTitle>
              <CardDescription>{t("ai:try.description")}</CardDescription>
            </CardHeader>
            <CardPanel className="p-4">
              <ul className="grid gap-2 sm:grid-cols-2">
                {(["triage", "plan", "notes", "report"] as const).map((k) => (
                  <li
                    key={k}
                    className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm"
                  >
                    “{t(`ai:try.examples.${k}`)}”
                  </li>
                ))}
              </ul>
            </CardPanel>
          </Card>
        </CardFrame>
      </div>
    </>
  );
}

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { EmailLogView } from "@/components/email/email-log-view";
import PageTitle from "@/components/page-title";
import { Button } from "@/components/ui/button";
import type { EmailStatus } from "@/fetchers/email-log";
import {
  useEmailLog,
  useMyEmailLog,
  useRetryEmail,
  useRetryMyEmail,
} from "@/hooks/queries/use-email-log";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { cn } from "@/lib/cn";

type Search = { tab?: "workspace" };

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/account/email",
)({
  validateSearch: (search: Record<string, unknown>): Search =>
    search.tab === "workspace" ? { tab: "workspace" } : {},
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();
  const { tab } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { workspace, canManageWorkspace } = useWorkspacePermission();
  const isAdmin = Boolean(canManageWorkspace());
  const showWorkspace = tab === "workspace" && isAdmin;
  const [status, setStatus] = useState<EmailStatus | undefined>(undefined);

  const mine = useMyEmailLog(showWorkspace ? undefined : status);
  const retryMine = useRetryMyEmail();
  const team = useEmailLog(showWorkspace ? workspace?.id : undefined, status);
  const retryTeam = useRetryEmail(workspace?.id);

  const tabs = [
    { key: undefined, label: t("emailLog:tabs.mine") },
    ...(isAdmin
      ? [
          {
            key: "workspace" as const,
            label: t("emailLog:tabs.workspace", {
              workspace: workspace?.name ?? "",
            }),
          },
        ]
      : []),
  ];

  return (
    <>
      <PageTitle title={t("emailLog:title")} />
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="space-y-2">
          <h1 className="font-semibold text-2xl">{t("emailLog:title")}</h1>
          <p className="text-muted-foreground">
            {showWorkspace
              ? t("emailLog:subtitle")
              : t("emailLog:mineSubtitle")}
          </p>
          <p className="text-muted-foreground text-sm">
            {t("emailLog:chooseWhich")}{" "}
            <Link
              to="/dashboard/settings/account/notifications"
              className="underline underline-offset-2 hover:text-foreground"
            >
              {t("emailLog:notificationSettings")}
            </Link>
          </p>
        </div>

        {tabs.length > 1 && (
          <div
            role="tablist"
            className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5"
          >
            {tabs.map((item) => {
              const active = (item.key === "workspace") === showWorkspace;
              return (
                <Button
                  key={item.key ?? "mine"}
                  role="tab"
                  aria-selected={active}
                  size="xs"
                  variant="ghost"
                  className={cn(
                    "rounded-md",
                    active && "bg-background shadow-xs hover:bg-background",
                  )}
                  onClick={() => {
                    setStatus(undefined);
                    void navigate({
                      search: item.key ? { tab: item.key } : {},
                    });
                  }}
                >
                  {item.label}
                </Button>
              );
            })}
          </div>
        )}

        {showWorkspace ? (
          <EmailLogView
            data={team.data}
            status={status}
            onStatusChange={setStatus}
            onRetry={(id) => retryTeam.mutateAsync(id)}
            retrying={retryTeam.isPending}
            show="recipient"
          />
        ) : (
          <EmailLogView
            data={mine.data}
            status={status}
            onStatusChange={setStatus}
            onRetry={(id) => retryMine.mutateAsync(id)}
            retrying={retryMine.isPending}
            show="workspace"
          />
        )}
      </div>
    </>
  );
}

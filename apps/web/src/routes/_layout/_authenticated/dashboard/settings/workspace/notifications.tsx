import { createFileRoute } from "@tanstack/react-router";
import { Lock, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { NotificationPolicy } from "@/fetchers/notification-policy";
import {
  useNotificationPolicies,
  useNotificationPolicyActions,
} from "@/hooks/queries/use-notification-policy";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { cn } from "@/lib/cn";
import { toast } from "@/lib/toast";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/workspace/notifications",
)({
  component: RouteComponent,
});

// Rows grouped the way people think about them. Anything new in the
// catalog that isn't listed here lands in "Other".
const GROUPS: { key: string; events: string[] }[] = [
  {
    key: "tasks",
    events: [
      "task_assigned",
      "task_status",
      "task_comment",
      "task_mention",
      "task_deleted",
      "project_activity",
      "time_entry",
    ],
  },
  {
    key: "deadlines",
    events: [
      "task_due",
      "task_due_today",
      "task_last_call",
      "task_overdue",
      "task_not_started",
      "task_stuck",
    ],
  },
  { key: "rhythm", events: ["daily_digest", "end_of_day"] },
  { key: "chat", events: ["chat_mention", "membership"] },
  { key: "requests", events: ["leave_decided", "expense_decided", "payslip"] },
  {
    key: "approvers",
    events: ["leave_requested", "leave_withdrawn", "expense_submitted"],
  },
  {
    key: "managers",
    events: ["member_joined", "workspace", "task_escalated", "team_summary"],
  },
];

const AUDIENCE_TONE: Record<NotificationPolicy["audience"], string> = {
  everyone: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  approvers: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  admins: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
};

function RouteComponent() {
  const { t } = useTranslation();
  const { workspace, canManageWorkspace } = useWorkspacePermission();
  const workspaceId = workspace?.id ?? "";
  const canEdit = Boolean(canManageWorkspace());
  const { data: rules = [] } = useNotificationPolicies(workspaceId);
  const { set, reset } = useNotificationPolicyActions(workspaceId);

  const listed = new Set(GROUPS.flatMap((group) => group.events));
  const groups = [
    ...GROUPS,
    {
      key: "other",
      events: rules.map((r) => r.key).filter((key) => !listed.has(key)),
    },
  ]
    .map((group) => ({
      key: group.key,
      rows: group.events
        .map((key) => rules.find((rule) => rule.key === key))
        .filter((rule): rule is NotificationPolicy => Boolean(rule)),
    }))
    .filter((group) => group.rows.length > 0);

  const fail = (error: unknown) =>
    toast.error(
      error instanceof Error ? error.message : t("notificationPolicy:error"),
    );

  const change = (
    rule: NotificationPolicy,
    patch: Partial<Pick<NotificationPolicy, "inApp" | "email" | "locked">>,
  ) =>
    set
      .mutateAsync({
        event: rule.key,
        rule: {
          inApp: patch.inApp ?? rule.inApp,
          email: patch.email ?? rule.email,
          locked: patch.locked ?? rule.locked,
        },
      })
      .catch(fail);

  const customCount = rules.filter((r) => r.custom).length;
  const lockedCount = rules.filter((r) => r.locked).length;

  return (
    <>
      <PageTitle title={t("notificationPolicy:title")} />
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="space-y-2">
          <h1 className="font-semibold text-2xl">
            {t("notificationPolicy:title")}
          </h1>
          <p className="text-muted-foreground">
            {t("notificationPolicy:subtitle", {
              workspace: workspace?.name ?? "",
            })}
          </p>
          <ul className="space-y-0.5 text-muted-foreground text-sm">
            <li>• {t("notificationPolicy:howDefault")}</li>
            <li>• {t("notificationPolicy:howLocked")}</li>
          </ul>
          <p className="text-muted-foreground text-xs">
            {t("notificationPolicy:summary", {
              custom: customCount,
              locked: lockedCount,
            })}
          </p>
          {!canEdit && (
            <p className="text-muted-foreground text-sm">
              {t("notificationPolicy:readOnly")}
            </p>
          )}
        </div>

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-muted/40 text-muted-foreground text-xs">
              <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left [&>th]:font-medium">
                <th>{t("notificationPolicy:col.event")}</th>
                <th className="w-40">{t("notificationPolicy:col.who")}</th>
                <th className="w-20 text-center!">
                  {t("notificationPolicy:col.inApp")}
                </th>
                <th className="w-20 text-center!">
                  {t("notificationPolicy:col.email")}
                </th>
                <th className="w-32 text-center!">
                  {t("notificationPolicy:col.membersCanChange")}
                </th>
                <th className="w-10" />
              </tr>
            </thead>
            {groups.map((group) => (
              <tbody key={group.key} className="divide-y divide-border">
                <tr className="bg-muted/20">
                  <td
                    colSpan={6}
                    className="px-3 pt-3 pb-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wide"
                  >
                    {t(`notificationPolicy:groups.${group.key}`)}
                  </td>
                </tr>
                {group.rows.map((rule) => (
                  <tr
                    key={rule.key}
                    className={cn(
                      "[&>td]:px-3 [&>td]:py-2",
                      rule.locked && "bg-primary/3",
                    )}
                  >
                    <td>
                      <div className="flex items-center gap-1.5 font-medium">
                        {t(
                          `settings:notificationsPage.events.${rule.key}.title`,
                          { defaultValue: rule.key },
                        )}
                        {rule.locked && (
                          <Lock
                            className="size-3 text-muted-foreground"
                            aria-label={t("notificationPolicy:locked")}
                          />
                        )}
                      </div>
                      <p className="text-muted-foreground text-xs">
                        {t(
                          `settings:notificationsPage.events.${rule.key}.hint`,
                          { defaultValue: "" },
                        )}
                      </p>
                    </td>
                    <td>
                      <span
                        className={cn(
                          "rounded-md px-1.5 py-0.5 font-medium text-[11px]",
                          AUDIENCE_TONE[rule.audience],
                        )}
                      >
                        {t(`notificationPolicy:audience.${rule.audience}`)}
                      </span>
                    </td>
                    <td className="text-center">
                      <Switch
                        checked={rule.inApp}
                        disabled={!canEdit}
                        aria-label={t("notificationPolicy:col.inApp")}
                        onCheckedChange={(value) =>
                          change(rule, { inApp: value })
                        }
                      />
                    </td>
                    <td className="text-center">
                      <Switch
                        checked={rule.email}
                        disabled={!canEdit}
                        aria-label={t("notificationPolicy:col.email")}
                        onCheckedChange={(value) =>
                          change(rule, { email: value })
                        }
                      />
                    </td>
                    <td className="text-center">
                      <Switch
                        checked={!rule.locked}
                        disabled={!canEdit}
                        aria-label={t(
                          "notificationPolicy:col.membersCanChange",
                        )}
                        onCheckedChange={(value) =>
                          change(rule, { locked: !value })
                        }
                      />
                    </td>
                    <td className="text-right">
                      {canEdit && rule.custom && (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label={t("notificationPolicy:reset")}
                          title={t("notificationPolicy:reset")}
                          disabled={reset.isPending}
                          onClick={() =>
                            reset.mutateAsync(rule.key).catch(fail)
                          }
                        >
                          <RotateCcw className="size-3.5" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      </div>
    </>
  );
}

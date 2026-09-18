import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Switch } from "@/components/ui/switch";
import type {
  NotificationEventSetting,
  NotificationPreferences,
} from "@/fetchers/notification-preferences/get-notification-preferences";
import updateNotificationPreferences from "@/fetchers/notification-preferences/update-notification-preferences";
import { toast } from "@/lib/toast";

const AUDIENCES = ["everyone", "approvers", "admins"] as const;
const QUERY_KEY = ["notification-preferences"];

/**
 * One row per event, with its own in-app and email switch. Changes save
 * straight away; approver and admin events only arrive for people with
 * those roles, but anyone can set them in advance.
 */
export function NotificationEventMatrix({
  events,
  emailEnabled,
}: {
  events: NotificationEventSetting[];
  /** The email channel as a whole; off means no event emails. */
  emailEnabled: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const change = async (
    key: string,
    channel: "inApp" | "email",
    value: boolean,
  ) => {
    // Flip it on screen first; the server answer replaces it.
    const previous =
      queryClient.getQueryData<NotificationPreferences>(QUERY_KEY);
    queryClient.setQueryData<NotificationPreferences>(QUERY_KEY, (data) =>
      data
        ? {
            ...data,
            events: data.events.map((event) =>
              event.key === key ? { ...event, [channel]: value } : event,
            ),
          }
        : data,
    );
    try {
      const saved = await updateNotificationPreferences({
        events: { [key]: { [channel]: value } },
      });
      queryClient.setQueryData(QUERY_KEY, saved);
    } catch (error) {
      queryClient.setQueryData(QUERY_KEY, previous);
      toast.error(
        error instanceof Error
          ? error.message
          : t("settings:notificationsPage.toastPreferencesSaveFailed"),
      );
    }
  };

  return (
    <div className="space-y-6">
      {AUDIENCES.map((audience) => {
        const rows = events.filter((event) => event.audience === audience);
        if (rows.length === 0) return null;
        return (
          <section key={audience} className="space-y-2">
            <div>
              <h3 className="font-medium text-sm">
                {t(`settings:notificationsPage.audience.${audience}`)}
              </h3>
              <p className="text-muted-foreground text-xs">
                {t(`settings:notificationsPage.audience.${audience}Hint`)}
              </p>
            </div>
            <div className="overflow-hidden rounded-md border border-border">
              <div className="grid grid-cols-[1fr_4.5rem_4.5rem] items-center gap-2 border-border border-b bg-muted/40 px-3 py-1.5 font-medium text-muted-foreground text-xs">
                <span>{t("settings:notificationsPage.eventColumn")}</span>
                <span className="text-center">
                  {t("settings:notificationsPage.inAppColumn")}
                </span>
                <span className="text-center">
                  {t("settings:notificationsPage.emailColumn")}
                </span>
              </div>
              <ul className="divide-y divide-border">
                {rows.map((event) => {
                  const title = t(
                    `settings:notificationsPage.events.${event.key}.title`,
                  );
                  return (
                    <li
                      key={event.key}
                      className="grid grid-cols-[1fr_4.5rem_4.5rem] items-center gap-2 px-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="text-sm">{title}</p>
                        <p className="text-muted-foreground text-xs">
                          {t(
                            `settings:notificationsPage.events.${event.key}.hint`,
                          )}
                        </p>
                      </div>
                      <span className="flex justify-center">
                        <Switch
                          checked={event.inApp}
                          aria-label={t("settings:notificationsPage.inAppFor", {
                            event: title,
                          })}
                          onCheckedChange={(checked) =>
                            void change(event.key, "inApp", checked)
                          }
                        />
                      </span>
                      <span
                        className="flex justify-center"
                        title={
                          emailEnabled
                            ? undefined
                            : t("settings:notificationsPage.emailChannelOff")
                        }
                      >
                        <Switch
                          checked={emailEnabled && event.email}
                          disabled={!emailEnabled}
                          aria-label={t("settings:notificationsPage.emailFor", {
                            event: title,
                          })}
                          onCheckedChange={(checked) =>
                            void change(event.key, "email", checked)
                          }
                        />
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>
        );
      })}
      {!emailEnabled && (
        <p className="text-muted-foreground text-xs">
          {t("settings:notificationsPage.emailChannelOff")}
        </p>
      )}
    </div>
  );
}

import { UserPlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  useInstanceRegistration,
  useInstanceRegistrationActions,
} from "@/hooks/queries/use-instance-registration";
import { formatDateMedium } from "@/lib/format";
import { toast } from "@/lib/toast";

// Server-wide sign-up control, set by the instance admin (the first person who
// signed up on this server). A saved value wins over DISABLE_REGISTRATION, and
// the API enforces it on every signup regardless of what this page renders.
export function RegistrationSetupCard() {
  const { t } = useTranslation();
  const { data: settings } = useInstanceRegistration(true);
  const { save, clear } = useInstanceRegistrationActions();

  if (!settings) return null;

  const fail = (error: unknown) =>
    toast.error(
      error instanceof Error ? error.message : t("registrationSetup:error"),
    );

  const setOpen = (open: boolean) =>
    save
      .mutateAsync({ disabled: !open })
      .then(() => toast.success(t("registrationSetup:saved")))
      .catch(fail);

  const followEnv = () =>
    clear
      .mutateAsync()
      .then(() => toast.success(t("registrationSetup:followEnvDone")))
      .catch(fail);

  const busy = save.isPending || clear.isPending;

  return (
    <section className="space-y-4 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <h2 className="flex items-center gap-2 font-medium">
            <UserPlus className="size-4 text-muted-foreground" />
            {t("registrationSetup:title")}
            <Badge variant="outline" size="sm">
              {t("registrationSetup:instanceAdmin")}
            </Badge>
          </h2>
          <p className="text-muted-foreground text-xs">
            {t("registrationSetup:subtitle")}
          </p>
        </div>
        <Badge variant={settings.disabled ? "warning" : "success"}>
          {settings.disabled
            ? t("registrationSetup:closed")
            : t("registrationSetup:open")}
        </Badge>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-sm">{t("registrationSetup:toggleLabel")}</p>
          <p className="text-muted-foreground text-xs">
            {t("registrationSetup:toggleHelp")}
          </p>
        </div>
        <Switch
          checked={!settings.disabled}
          disabled={busy}
          onCheckedChange={(checked) => void setOpen(checked)}
          aria-label={t("registrationSetup:toggleLabel")}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <p className="text-muted-foreground text-xs">
          {settings.source === "app"
            ? t("registrationSetup:sourceApp")
            : t("registrationSetup:sourceEnv")}
          {settings.source === "app" && settings.updatedAt && (
            <>
              {" · "}
              {t("registrationSetup:updated", {
                date: formatDateMedium(settings.updatedAt),
                name: settings.updatedByName ?? "",
              })}
            </>
          )}
        </p>
        {settings.source === "app" && (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void followEnv()}
          >
            {t("registrationSetup:followEnv")}
          </Button>
        )}
      </div>
    </section>
  );
}

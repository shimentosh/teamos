import { ExternalLink, KeyRound, Send } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useInstanceEmail,
  useInstanceEmailActions,
} from "@/hooks/queries/use-instance-email";
import { formatDateMedium } from "@/lib/format";
import { toast } from "@/lib/toast";

// Server-wide email delivery, set up by the instance admin (the first person
// who signed up on this server). Saved settings win over environment
// variables; the key is stored encrypted and only its last 4 characters
// ever come back.
export function EmailSetupCard() {
  const { t } = useTranslation();
  const id = useId();
  const { data: settings } = useInstanceEmail(true);
  const { save, clear, test } = useInstanceEmailActions();
  const [apiKey, setApiKey] = useState("");
  const [from, setFrom] = useState("");

  useEffect(() => {
    if (settings) setFrom(settings.savedFrom ?? settings.from ?? "");
  }, [settings]);

  if (!settings) return null;

  const fail = (error: unknown) =>
    toast.error(error instanceof Error ? error.message : t("emailSetup:error"));

  const saveAndTest = async () => {
    try {
      await save.mutateAsync({
        resendApiKey: apiKey.trim() || undefined,
        from: from.trim(),
      });
      setApiKey("");
      const sent = await test.mutateAsync();
      toast.success(t("emailSetup:testSent", { to: sent.to }));
    } catch (error) {
      fail(error);
    }
  };

  const sendTest = () =>
    test
      .mutateAsync()
      .then((sent) => toast.success(t("emailSetup:testSent", { to: sent.to })))
      .catch(fail);

  return (
    <section className="space-y-4 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <h2 className="flex items-center gap-2 font-medium">
            <KeyRound className="size-4 text-muted-foreground" />
            {t("emailSetup:title")}
            <Badge variant="outline" size="sm">
              {t("emailSetup:instanceAdmin")}
            </Badge>
          </h2>
          <p className="text-muted-foreground text-xs">
            {t("emailSetup:subtitle")}
          </p>
        </div>
        {settings.provider ? (
          <Badge variant="success">
            {settings.source === "app"
              ? t("emailSetup:sourceApp")
              : t("emailSetup:sourceEnv", {
                  provider: settings.provider === "resend" ? "Resend" : "SMTP",
                })}
          </Badge>
        ) : (
          <Badge variant="warning">{t("emailSetup:notSet")}</Badge>
        )}
      </div>

      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void saveAndTest();
        }}
      >
        <div className="space-y-1">
          <Label htmlFor={`${id}-key`} className="text-xs">
            {t("emailSetup:apiKey")}
          </Label>
          <Input
            id={`${id}-key`}
            name="resend-api-key"
            type="password"
            autoComplete="new-password"
            data-1p-ignore
            data-lpignore="true"
            spellCheck={false}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={
              settings.resendKeyHint
                ? t("emailSetup:keyKept", { hint: settings.resendKeyHint })
                : "re_…"
            }
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-from`} className="text-xs">
            {t("emailSetup:from")}
          </Label>
          <Input
            id={`${id}-from`}
            name="email-from"
            autoComplete="off"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            placeholder="TeamOS <notifications@yourcompany.com>"
          />
        </div>
        <p className="text-muted-foreground text-xs sm:col-span-2">
          {t("emailSetup:help")}{" "}
          <a
            href="https://resend.com/api-keys"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 underline underline-offset-2 hover:text-foreground"
          >
            resend.com/api-keys
            <ExternalLink className="size-3" />
          </a>
        </p>
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
          <Button
            type="submit"
            size="sm"
            disabled={
              save.isPending ||
              test.isPending ||
              !from.trim() ||
              (!apiKey.trim() && !settings.resendKeyHint)
            }
          >
            {save.isPending || test.isPending
              ? t("emailSetup:saving")
              : t("emailSetup:saveAndTest")}
          </Button>
          {settings.provider && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1"
              disabled={test.isPending}
              onClick={sendTest}
            >
              <Send className="size-3.5" />
              {t("emailSetup:sendTest")}
            </Button>
          )}
          {settings.source === "app" && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={clear.isPending}
              onClick={() =>
                clear
                  .mutateAsync()
                  .then(() => toast.success(t("emailSetup:cleared")))
                  .catch(fail)
              }
            >
              {t("emailSetup:clear")}
            </Button>
          )}
          {settings.updatedAt && (
            <span className="text-muted-foreground text-xs">
              {t("emailSetup:updated", {
                date: formatDateMedium(settings.updatedAt),
                name: settings.updatedByName ?? "",
              })}
            </span>
          )}
        </div>
      </form>
    </section>
  );
}

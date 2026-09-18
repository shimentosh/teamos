import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { StorageSettings } from "@/components/files/storage-settings";
import PageTitle from "@/components/page-title";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/account/storage",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();

  return (
    <>
      <PageTitle title={t("files:storage.title")} />
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">{t("files:storage.title")}</h1>
          <p className="text-muted-foreground">
            {t("files:storage.accountSubtitle")}
          </p>
        </div>
        <div className="rounded-lg border border-border p-4">
          <StorageSettings />
        </div>
      </div>
    </>
  );
}

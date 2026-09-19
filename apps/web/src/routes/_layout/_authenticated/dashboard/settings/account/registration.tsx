import { createFileRoute, redirect } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { RegistrationSetupCard } from "@/components/instance/registration-setup-card";
import PageTitle from "@/components/page-title";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/account/registration",
)({
  // Server-wide setting: only the instance admin has any business here. The
  // API enforces the same check, so this is about not showing a dead end.
  beforeLoad: async () => {
    const session = await authClient.getSession();
    if (session?.data?.user?.role !== "admin") {
      throw redirect({ to: "/dashboard/settings/account/information" });
    }
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();

  return (
    <>
      <PageTitle title={t("registrationSetup:title")} />
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">
            {t("registrationSetup:title")}
          </h1>
          <p className="text-muted-foreground">
            {t("registrationSetup:subtitle")}
          </p>
        </div>
        <RegistrationSetupCard />
      </div>
    </>
  );
}

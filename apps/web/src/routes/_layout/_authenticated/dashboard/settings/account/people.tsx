import { isSuperAdminRole } from "@kaneo/permissions";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { InstancePeopleCard } from "@/components/instance/instance-people-card";
import PageTitle from "@/components/page-title";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/account/people",
)({
  // Handing out instance tiers is the super-admin's alone; a plain admin would
  // otherwise be able to promote themselves. The API enforces the same check.
  beforeLoad: async () => {
    const session = await authClient.getSession();
    if (!isSuperAdminRole(session?.data?.user?.role)) {
      throw redirect({ to: "/dashboard/settings/account/information" });
    }
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();

  return (
    <>
      <PageTitle title={t("instancePeople:title")} />
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">
            {t("instancePeople:title")}
          </h1>
          <p className="text-muted-foreground">
            {t("instancePeople:subtitle")}
          </p>
        </div>
        <InstancePeopleCard />
      </div>
    </>
  );
}

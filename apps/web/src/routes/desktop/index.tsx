import {
  createFileRoute,
  useNavigate,
  useSearch,
} from "@tanstack/react-router";
import { Monitor } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod/v4";
import { AuthLayout } from "@/components/auth/layout";
import PageTitle from "@/components/page-title";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { DESKTOP_SCHEME } from "@/lib/desktop";
import { toast } from "@/lib/toast";

/**
 * Hands this browser's session to the TeamOS desktop app.
 *
 * The desktop app opens this page in the system browser with a `state` value it
 * generated. Once the user confirms, the browser mints a single-use token and
 * redirects to the app's deep link carrying the token and the same `state`. The
 * app drops a callback whose `state` it did not issue, so a link a user was
 * tricked into opening cannot sign a waiting app into someone else's account.
 *
 * The token is single-use and expires in two minutes. It carries this browser's
 * session rather than creating a second one, so signing out here also signs the
 * desktop app out.
 */

const desktopSearchSchema = z.object({
  state: z.string().optional(),
});

export const Route = createFileRoute("/desktop/")({
  component: DesktopHandoffPage,
  validateSearch: desktopSearchSchema,
});

// The desktop app sends 64 hex characters; anything outside this shape did not
// come from it.
const STATE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

function DesktopHandoffPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const search = useSearch({ from: "/desktop/" });
  const { data: session, isPending } = authClient.useSession();
  const [handedOff, setHandedOff] = useState(false);
  const [working, setWorking] = useState(false);

  const state = search.state?.trim() ?? "";
  const isValidState = STATE_PATTERN.test(state);

  const handleContinue = async () => {
    setWorking(true);
    try {
      const result = await authClient.oneTimeToken.generate();
      const token = result.data?.token;
      if (result.error || !token) {
        toast.error(t("desktopApp:handoff.error"));
        return;
      }

      setHandedOff(true);
      window.location.href = `${DESKTOP_SCHEME}://auth/callback?token=${encodeURIComponent(
        token,
      )}&state=${encodeURIComponent(state)}`;
    } catch {
      toast.error(t("desktopApp:handoff.error"));
    } finally {
      setWorking(false);
    }
  };

  if (isPending) {
    return (
      <AuthLayout title={t("desktopApp:handoff.title")}>
        <div className="text-muted-foreground text-sm">
          {t("desktopApp:handoff.checkingSession")}
        </div>
      </AuthLayout>
    );
  }

  if (!isValidState) {
    return (
      <>
        <PageTitle title={t("desktopApp:handoff.pageTitle")} />
        <AuthLayout
          title={t("desktopApp:handoff.invalidTitle")}
          subtitle={t("desktopApp:handoff.invalidSubtitle")}
        >
          <Button
            className="w-full"
            variant="secondary"
            onClick={() => void navigate({ to: "/dashboard" })}
          >
            {t("desktopApp:handoff.goToTeamOS")}
          </Button>
        </AuthLayout>
      </>
    );
  }

  if (!session?.user) {
    const redirectTarget = `/desktop?state=${encodeURIComponent(state)}`;
    return (
      <>
        <PageTitle title={t("desktopApp:handoff.pageTitle")} />
        <AuthLayout
          title={t("desktopApp:handoff.signInTitle")}
          subtitle={t("desktopApp:handoff.signInSubtitle")}
        >
          <Button
            className="w-full"
            onClick={() =>
              void navigate({
                to: "/auth/sign-in",
                search: { redirect: redirectTarget },
              })
            }
          >
            {t("desktopApp:handoff.signInButton")}
          </Button>
        </AuthLayout>
      </>
    );
  }

  if (handedOff) {
    return (
      <>
        <PageTitle title={t("desktopApp:handoff.pageTitle")} />
        <AuthLayout
          title={t("desktopApp:handoff.doneTitle")}
          subtitle={t("desktopApp:handoff.doneSubtitle")}
        >
          <Button
            className="w-full"
            variant="secondary"
            onClick={() => void handleContinue()}
          >
            {t("desktopApp:handoff.retry")}
          </Button>
        </AuthLayout>
      </>
    );
  }

  return (
    <>
      <PageTitle title={t("desktopApp:handoff.pageTitle")} />
      <AuthLayout
        title={t("desktopApp:handoff.title")}
        subtitle={t("desktopApp:handoff.subtitle", {
          email: session.user.email,
        })}
      >
        <div className="space-y-3">
          <Button
            className="w-full"
            onClick={() => void handleContinue()}
            disabled={working}
          >
            <Monitor className="mr-2 h-4 w-4" />
            {t("desktopApp:handoff.continueButton")}
          </Button>
          <Button
            className="w-full"
            variant="ghost"
            onClick={() =>
              void authClient.signOut().then(() =>
                navigate({
                  to: "/auth/sign-in",
                  search: {
                    redirect: `/desktop?state=${encodeURIComponent(state)}`,
                  },
                }),
              )
            }
          >
            {t("desktopApp:handoff.differentAccount")}
          </Button>
        </div>
      </AuthLayout>
    </>
  );
}

import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import { Button } from "@/components/ui/button";
import { startDesktopLogin } from "@/lib/desktop";
import { AuthLayout } from "./layout";

/**
 * The signed-out screen inside the desktop shell.
 *
 * The shell never collects credentials itself. It opens the system browser,
 * where the user signs in with whatever the instance offers — password, email
 * code, GitHub — and the browser hands the session back over the app's deep
 * link. That also means a password manager, a passkey and an SSO session all
 * work exactly as they do on the web.
 */
export function DesktopSignIn() {
  const { t } = useTranslation();
  const [opening, setOpening] = useState(false);

  const handleSignIn = async () => {
    setOpening(true);
    await startDesktopLogin();
    // The window stays on this screen until the browser hands the session
    // back; the shell navigates it once that happens.
  };

  return (
    <>
      <PageTitle title={t("desktopApp:signIn.pageTitle")} />
      <AuthLayout
        title={t("desktopApp:signIn.title")}
        subtitle={t("desktopApp:signIn.subtitle")}
      >
        <div className="space-y-3">
          <Button
            className="w-full"
            onClick={() => void handleSignIn()}
            disabled={opening}
          >
            <ExternalLink className="mr-2 h-4 w-4" />
            {opening
              ? t("desktopApp:signIn.opening")
              : t("desktopApp:signIn.button")}
          </Button>
          <p className="text-center text-muted-foreground text-xs">
            {t("desktopApp:signIn.hint")}
          </p>
        </div>
      </AuthLayout>
    </>
  );
}

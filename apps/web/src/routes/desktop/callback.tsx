import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AuthLayout } from "@/components/auth/layout";
import PageTitle from "@/components/page-title";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { startDesktopLogin } from "@/lib/desktop";

/**
 * Redeems the single-use token the browser produced, inside the desktop shell.
 *
 * The shell navigates its window here with the token in the URL fragment, which
 * never reaches the server as part of the request line and so stays out of
 * access logs and referrers. Redeeming it sets the normal session cookie in the
 * shell's webview; from there the desktop app is an ordinary signed-in client.
 */

export const Route = createFileRoute("/desktop/callback")({
  component: DesktopCallbackPage,
});

function readTokenFromHash(): string | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash) return null;
  return new URLSearchParams(hash).get("token")?.trim() || null;
}

function DesktopCallbackPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);
  // React runs effects twice in development; redeeming a single-use token
  // twice would fail the second time and show a spurious error.
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const token = readTokenFromHash();

    // Drop the token from the address bar before anything can read it back
    // out of history.
    window.history.replaceState(null, "", window.location.pathname);

    if (!token) {
      setFailed(true);
      return;
    }

    void authClient.oneTimeToken
      .verify({ token })
      .then((result) => {
        if (result.error) {
          setFailed(true);
          return;
        }
        void navigate({ to: "/dashboard", replace: true });
      })
      .catch(() => setFailed(true));
  }, [navigate]);

  if (failed) {
    return (
      <>
        <PageTitle title={t("desktopApp:callback.pageTitle")} />
        <AuthLayout
          title={t("desktopApp:callback.errorTitle")}
          subtitle={t("desktopApp:callback.errorSubtitle")}
        >
          <Button className="w-full" onClick={() => void startDesktopLogin()}>
            {t("desktopApp:callback.retry")}
          </Button>
        </AuthLayout>
      </>
    );
  }

  return (
    <>
      <PageTitle title={t("desktopApp:callback.pageTitle")} />
      <AuthLayout
        title={t("desktopApp:callback.title")}
        subtitle={t("desktopApp:callback.subtitle")}
      >
        <div className="text-muted-foreground text-sm">
          {t("desktopApp:callback.working")}
        </div>
      </AuthLayout>
    </>
  );
}

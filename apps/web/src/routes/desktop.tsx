import { createFileRoute, Outlet } from "@tanstack/react-router";

/**
 * Desktop app sign-in lives outside `/auth` on purpose: that layout sends a
 * signed-in visitor to the dashboard, and the handoff below only makes sense
 * for someone who is already signed in.
 */
export const Route = createFileRoute("/desktop")({
  component: DesktopLayout,
});

function DesktopLayout() {
  return <Outlet />;
}

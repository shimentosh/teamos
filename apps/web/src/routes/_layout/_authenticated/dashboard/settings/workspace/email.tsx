import { createFileRoute, redirect } from "@tanstack/react-router";

// Email moved to Settings → Account → Email; the workspace log is a tab there.
export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/workspace/email",
)({
  beforeLoad: () => {
    throw redirect({
      to: "/dashboard/settings/account/email",
      search: { tab: "workspace" },
      replace: true,
    });
  },
});

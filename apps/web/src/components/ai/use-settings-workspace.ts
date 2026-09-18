import { useEffect } from "react";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { authClient } from "@/lib/auth-client";

/**
 * The workspace a settings page acts on. When the session has none yet
 * (straight to settings after signing in), the first workspace becomes the
 * active one, as the workspace switcher would, so permissions load too.
 */
export function useSettingsWorkspace() {
  const { data: active } = useActiveWorkspace();
  const { data: organizations } = authClient.useListOrganizations();
  const first = organizations?.[0];
  useEffect(() => {
    if (!active && first) {
      void authClient.organization.setActive({ organizationId: first.id });
    }
  }, [active, first]);
  return active ?? first ?? null;
}

/** Switch which workspace the settings page acts on. */
export function useWorkspaceChoices() {
  const { data } = authClient.useListOrganizations();
  return {
    organizations: data ?? [],
    choose: (organizationId: string) =>
      authClient.organization.setActive({ organizationId }),
  };
}

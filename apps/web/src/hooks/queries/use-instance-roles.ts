import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type InstanceRole, instanceRolesApi } from "@/fetchers/instance-roles";

const rolesKey = ["instance", "roles"];

export type { InstanceRole };

export function useInstanceRoles(enabled = true) {
  return useQuery({
    queryKey: rolesKey,
    queryFn: instanceRolesApi.list,
    enabled,
  });
}

export function useInstanceRoleActions() {
  const queryClient = useQueryClient();
  const onSuccess = () => {
    void queryClient.invalidateQueries({ queryKey: rolesKey });
    // A role's permissions decide what the UI offers, so the capability map
    // and the grantable-role picker have to be re-read.
    void queryClient.invalidateQueries({
      queryKey: ["workspace-capabilities"],
    });
  };

  return {
    create: useMutation({ mutationFn: instanceRolesApi.create, onSuccess }),
    update: useMutation({ mutationFn: instanceRolesApi.update, onSuccess }),
    remove: useMutation({ mutationFn: instanceRolesApi.remove, onSuccess }),
  };
}

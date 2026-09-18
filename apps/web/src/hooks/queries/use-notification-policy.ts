import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type NotificationPolicy,
  notificationPolicyApi,
} from "@/fetchers/notification-policy";

const key = (workspaceId: string) => ["notification-policy", workspaceId];

export function useNotificationPolicies(workspaceId: string | undefined) {
  return useQuery({
    queryKey: key(workspaceId ?? ""),
    queryFn: () => notificationPolicyApi.list(workspaceId as string),
    enabled: !!workspaceId,
  });
}

export function useNotificationPolicyActions(workspaceId: string) {
  const queryClient = useQueryClient();
  const settle = (rules: NotificationPolicy[]) =>
    queryClient.setQueryData(key(workspaceId), rules);
  return {
    // Flips on screen first; the server's list replaces it.
    set: useMutation({
      mutationFn: ({
        event,
        rule,
      }: {
        event: string;
        rule: { inApp: boolean; email: boolean; locked: boolean };
      }) => notificationPolicyApi.set(workspaceId, event, rule),
      onMutate: async ({ event, rule }) => {
        await queryClient.cancelQueries({ queryKey: key(workspaceId) });
        const previous = queryClient.getQueryData<NotificationPolicy[]>(
          key(workspaceId),
        );
        queryClient.setQueryData<NotificationPolicy[]>(
          key(workspaceId),
          (rules) =>
            rules?.map((r) =>
              r.key === event ? { ...r, ...rule, custom: true } : r,
            ),
        );
        return { previous };
      },
      onError: (_e, _v, context) => {
        if (context?.previous) settle(context.previous);
      },
      onSuccess: settle,
    }),
    reset: useMutation({
      mutationFn: (event: string) =>
        notificationPolicyApi.reset(workspaceId, event),
      onSuccess: settle,
    }),
  };
}

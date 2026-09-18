import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { type EmailStatus, emailLogApi } from "@/fetchers/email-log";

export function useEmailLog(
  workspaceId: string | undefined,
  status: EmailStatus | undefined,
) {
  return useQuery({
    queryKey: ["email-log", workspaceId, status ?? "all"],
    queryFn: () => emailLogApi.list(workspaceId as string, status),
    enabled: !!workspaceId,
    placeholderData: keepPreviousData,
    // Queued mail turns into sent mail within a minute; keep the view honest.
    refetchInterval: 30_000,
  });
}

export function useMyEmailLog(status: EmailStatus | undefined) {
  return useQuery({
    queryKey: ["email-log", "mine", status ?? "all"],
    queryFn: () => emailLogApi.mine(status),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });
}

export function useRetryMyEmail() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => emailLogApi.retryMine(id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["email-log", "mine"] }),
  });
}

export function useRetryEmail(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => emailLogApi.retry(workspaceId as string, id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["email-log", workspaceId] }),
  });
}

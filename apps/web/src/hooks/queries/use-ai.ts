import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type AgentScope, aiApi } from "@/fetchers/ai";

export function useAgentConnectInfo() {
  return useQuery({ queryKey: ["ai", "connect"], queryFn: aiApi.connect });
}

export function useAgentKeys() {
  return useQuery({ queryKey: ["ai", "agent-keys"], queryFn: aiApi.keys });
}

export function useAgentKeyActions() {
  const queryClient = useQueryClient();
  const onSuccess = () =>
    queryClient.invalidateQueries({ queryKey: ["ai", "agent-keys"] });
  return {
    create: useMutation({
      mutationFn: (input: { name?: string; scope: AgentScope }) =>
        aiApi.create(input),
      onSuccess,
    }),
    revoke: useMutation({ mutationFn: aiApi.revoke, onSuccess }),
    revokeAll: useMutation({ mutationFn: aiApi.revokeAll, onSuccess }),
  };
}

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import getLivePeople from "@/fetchers/people/get-live-people";

/**
 * Who is working in what right now. Refreshed when the server announces a
 * change over the user WebSocket, and every 30 s in case a nudge is missed.
 */
function useLivePeople(workspaceId: string | undefined) {
  const query = useQuery({
    queryKey: ["people-live", workspaceId],
    queryFn: () => getLivePeople(workspaceId as string),
    enabled: !!workspaceId,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
  const byUser = useMemo(
    () => new Map((query.data ?? []).map((p) => [p.userId, p])),
    [query.data],
  );
  return { ...query, byUser };
}

export default useLivePeople;

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PersonTask } from "@/fetchers/people/get-person-tasks";
import setTaskOrder from "@/fetchers/people/set-task-order";

/** Saves the person's own My work order; the list reorders immediately. */
function useSetTaskOrder(workspaceId: string, userId: string) {
  const queryClient = useQueryClient();
  const listKey = ["people", workspaceId, userId, "tasks"];

  return useMutation({
    // One save at a time, in the order they were made: two quick drags must
    // not land out of order on the server.
    scope: { id: `task-order:${workspaceId}:${userId}` },
    mutationFn: (taskIds: string[]) =>
      setTaskOrder(workspaceId, userId, taskIds),
    onMutate: async (taskIds) => {
      await queryClient.cancelQueries({ queryKey: listKey });
      const previous = queryClient.getQueryData<PersonTask[]>(listKey);
      const position = new Map(taskIds.map((id, index) => [id, index]));
      queryClient.setQueryData<PersonTask[]>(listKey, (tasks) =>
        tasks?.map((task) => ({
          ...task,
          myPosition: position.get(task.id) ?? null,
        })),
      );
      return { previous };
    },
    onError: (_error, _ids, context) => {
      if (context?.previous)
        queryClient.setQueryData(listKey, context.previous);
    },
    // Whatever happened, show what the server kept.
    onSettled: () => queryClient.invalidateQueries({ queryKey: listKey }),
  });
}

export default useSetTaskOrder;

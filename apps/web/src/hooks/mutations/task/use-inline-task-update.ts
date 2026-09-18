import { client } from "@kaneo/libs";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { InferRequestType } from "hono/client";
import type { PersonTask } from "@/fetchers/people/get-person-tasks";
import { syncTimerAfterStatusChange } from "@/lib/timer-sync";

type Priority = InferRequestType<
  (typeof client)["task"]["priority"][":id"]["$put"]
>["json"]["priority"];

type Change =
  | { field: "status"; value: string; label?: string; isFinal?: boolean }
  | { field: "priority"; value: Priority }
  | { field: "dueDate"; value: string | null }
  | { field: "assignee"; value: string | null };

async function send(taskId: string, change: Change) {
  const param = { id: taskId };
  const response =
    change.field === "status"
      ? await client.task.status[":id"].$put({
          param,
          json: { status: change.value },
        })
      : change.field === "priority"
        ? await client.task.priority[":id"].$put({
            param,
            json: { priority: change.value },
          })
        : change.field === "dueDate"
          ? await client.task["due-date"][":id"].$put({
              param,
              json: { dueDate: change.value ?? "" },
            })
          : await client.task.assignee[":id"].$put({
              param,
              json: { userId: change.value ?? "" },
            });
  if (!response.ok) throw new Error(await response.text());
}

function applyChange(task: PersonTask, change: Change): PersonTask {
  switch (change.field) {
    case "priority":
      return { ...task, priority: change.value };
    case "dueDate":
      return { ...task, dueDate: change.value };
    case "status":
      return {
        ...task,
        status: change.value,
        statusName: change.label ?? task.statusName,
        done: change.isFinal ?? task.done,
      };
    default:
      return task;
  }
}

/** Status, priority, due date and assignee edits from a person's task list. */
function useInlineTaskUpdate(workspaceId: string, userId: string) {
  const queryClient = useQueryClient();
  const listKey = ["people", workspaceId, userId, "tasks"];

  return useMutation({
    mutationFn: ({ task, change }: { task: PersonTask; change: Change }) =>
      send(task.id, change),
    onMutate: async ({ task, change }) => {
      await queryClient.cancelQueries({ queryKey: listKey });
      const previous = queryClient.getQueryData<PersonTask[]>(listKey);
      queryClient.setQueryData<PersonTask[]>(listKey, (tasks) =>
        // Handing the task to someone else takes it off this person's list.
        change.field === "assignee" && change.value !== userId
          ? tasks?.filter((t) => t.id !== task.id)
          : tasks?.map((t) => (t.id === task.id ? applyChange(t, change) : t)),
      );
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous)
        queryClient.setQueryData(listKey, context.previous);
    },
    onSettled: (_data, error, { task, change }) => {
      if (!error && change.field === "status") {
        void syncTimerAfterStatusChange(queryClient);
      }
      void queryClient.invalidateQueries({ queryKey: ["people", workspaceId] });
      void queryClient.invalidateQueries({
        queryKey: ["tasks", task.projectId],
      });
      void queryClient.invalidateQueries({ queryKey: ["task", task.id] });
    },
  });
}

export default useInlineTaskUpdate;

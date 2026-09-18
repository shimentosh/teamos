import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { expenseCategoryApi } from "@/fetchers/expense-category";

const key = (workspaceId: string) => ["expense-categories", workspaceId];

export function useExpenseCategories(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: key(workspaceId),
    queryFn: () => expenseCategoryApi.list(workspaceId),
    enabled: !!workspaceId && enabled,
  });
}

export function useExpenseCategoryActions(workspaceId: string) {
  const queryClient = useQueryClient();
  const onSuccess = () =>
    queryClient.invalidateQueries({ queryKey: key(workspaceId) });
  return {
    create: useMutation({
      mutationFn: ({ name, icon }: { name: string; icon?: string }) =>
        expenseCategoryApi.create(workspaceId, name, icon),
      onSuccess,
    }),
    setIcon: useMutation({
      mutationFn: ({ id, icon }: { id: string; icon: string }) =>
        expenseCategoryApi.setIcon(workspaceId, id, icon),
      onSuccess,
    }),
    remove: useMutation({
      mutationFn: (id: string) => expenseCategoryApi.remove(workspaceId, id),
      onSuccess,
    }),
  };
}

import { useMutation, useQueryClient } from "@tanstack/react-query";
import createTimeEntry, {
  type CreateTimeEntryRequest,
} from "@/fetchers/time-entry/create-time-entry";

function useCreateTimeEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateTimeEntryRequest) => createTimeEntry(data),
    // Starting a timer can stop another one anywhere, and moves a task that
    // hadn't started to In Progress, so refresh every view.
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["time-entries"] });
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
      void queryClient.invalidateQueries({ queryKey: ["task"] });
      void queryClient.invalidateQueries({ queryKey: ["people"] });
    },
  });
}

export default useCreateTimeEntry;

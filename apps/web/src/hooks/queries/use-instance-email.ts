import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { emailTemplatesApi, instanceEmailApi } from "@/fetchers/instance-email";

const settingsKey = ["instance", "email"];

export function useInstanceEmail(enabled: boolean) {
  return useQuery({
    queryKey: settingsKey,
    queryFn: instanceEmailApi.get,
    enabled,
  });
}

export function useInstanceEmailActions() {
  const queryClient = useQueryClient();
  const onSuccess = () => {
    void queryClient.invalidateQueries({ queryKey: settingsKey });
    // The email log shows whether sending is set up.
    void queryClient.invalidateQueries({ queryKey: ["email-log"] });
  };
  return {
    save: useMutation({ mutationFn: instanceEmailApi.save, onSuccess }),
    clear: useMutation({ mutationFn: instanceEmailApi.clear, onSuccess }),
    test: useMutation({ mutationFn: instanceEmailApi.test }),
  };
}

export function useEmailTemplates(enabled: boolean) {
  return useQuery({
    queryKey: ["email-templates"],
    queryFn: emailTemplatesApi.list,
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}

/** Sends one email with sample data to yourself; it shows in your log. */
export function useSendTestEmail() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: emailTemplatesApi.sendTest,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["email-log", "mine"] }),
  });
}

export function useEmailPreview(type: string | null) {
  return useQuery({
    queryKey: ["email-templates", type],
    queryFn: () => emailTemplatesApi.preview(type as string),
    enabled: !!type,
    staleTime: 5 * 60 * 1000,
  });
}

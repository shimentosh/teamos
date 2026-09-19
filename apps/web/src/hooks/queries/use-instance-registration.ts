import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { instanceRegistrationApi } from "@/fetchers/instance-registration";

const settingsKey = ["instance", "registration"];

export function useInstanceRegistration(enabled: boolean) {
  return useQuery({
    queryKey: settingsKey,
    queryFn: instanceRegistrationApi.get,
    enabled,
  });
}

export function useInstanceRegistrationActions() {
  const queryClient = useQueryClient();
  const onSuccess = () => {
    void queryClient.invalidateQueries({ queryKey: settingsKey });
    // The sign-in and sign-up screens read registration state from /config.
    void queryClient.invalidateQueries({ queryKey: ["config"] });
  };
  return {
    save: useMutation({ mutationFn: instanceRegistrationApi.save, onSuccess }),
    clear: useMutation({
      mutationFn: instanceRegistrationApi.clear,
      onSuccess,
    }),
  };
}

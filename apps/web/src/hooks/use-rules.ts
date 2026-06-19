import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { Rule } from "@slopshield/shared";

export function useRules() {
  return useQuery({
    queryKey: ["rules"],
    queryFn: () => apiClient.get<Rule[]>("/rules"),
  });
}

export function useUpdateRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<Rule> }) => {
      return apiClient.patch<Rule>(`/rules/${id}`, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rules"] });
    },
  });
}

export function useToggleRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enable }: { id: string; enable: boolean }) => {
      const endpoint = `/rules/${id}/${enable ? "enable" : "disable"}`;
      return apiClient.post<Rule>(endpoint);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rules"] });
    },
  });
}

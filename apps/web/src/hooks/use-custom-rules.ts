import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { CustomRule } from "@slopshield/shared";

interface ProjectSummary {
  id: string;
  name: string;
}

/** List projects (for the custom-rule project selector). */
export function useProjects() {
  return useQuery({
    queryKey: ["projects"],
    queryFn: () => apiClient.get<ProjectSummary[]>("/projects"),
  });
}

/** Load a project's custom rules. */
export function useCustomRules(projectId: string | null) {
  return useQuery({
    queryKey: ["custom-rules", projectId],
    queryFn: () =>
      apiClient.get<CustomRule[]>(`/projects/${projectId}/custom-rules`),
    enabled: !!projectId,
  });
}

/** Persist a project's full custom-rule set. */
export function useSaveCustomRules() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      projectId,
      rules,
    }: {
      projectId: string;
      rules: CustomRule[];
    }) =>
      apiClient.put<CustomRule[]>(`/projects/${projectId}/custom-rules`, {
        rules,
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["custom-rules", variables.projectId],
      });
    },
  });
}

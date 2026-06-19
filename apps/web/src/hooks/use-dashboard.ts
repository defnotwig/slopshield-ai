import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";

export function useDashboardSummary(projectId?: string) {
  return useQuery({
    queryKey: ["dashboard-summary", projectId],
    queryFn: () => {
      const path = projectId
        ? `/dashboard/summary?projectId=${projectId}`
        : "/dashboard/summary";
      return apiClient.get<any>(path);
    },
  });
}

export function useDashboardTrends(projectId?: string) {
  return useQuery({
    queryKey: ["dashboard-trends", projectId],
    queryFn: () => {
      const path = projectId
        ? `/dashboard/trends?projectId=${projectId}`
        : "/dashboard/trends";
      return apiClient.get<any[]>(path);
    },
  });
}

export function useDashboardTopIssues(projectId?: string) {
  return useQuery({
    queryKey: ["dashboard-top-issues", projectId],
    queryFn: () => {
      const path = projectId
        ? `/dashboard/top-issues?projectId=${projectId}`
        : "/dashboard/top-issues";
      return apiClient.get<any[]>(path);
    },
  });
}

export function useDashboardStandards(projectId?: string) {
  return useQuery({
    queryKey: ["dashboard-standards", projectId],
    queryFn: () => {
      const path = projectId
        ? `/dashboard/standards?projectId=${projectId}`
        : "/dashboard/standards";
      return apiClient.get<any[]>(path);
    },
  });
}

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { CreateScanInput } from '@slopshield/shared';

export function useScans(page = 1, limit = 10, projectId?: string, status?: string) {
  return useQuery({
    queryKey: ['scans', page, limit, projectId, status],
    queryFn: () => {
      let url = `/scans?page=${page}&limit=${limit}`;
      if (projectId) url += `&projectId=${projectId}`;
      if (status) url += `&status=${status}`;
      return apiClient.get<any>(url);
    },
  });
}

export function useScan(id: string) {
  return useQuery({
    queryKey: ['scan', id],
    queryFn: () => apiClient.get<any>(`/scans/${id}`),
    enabled: !!id,
  });
}

export function useScanFindings(scanId: string, category?: string, severity?: string) {
  return useQuery({
    queryKey: ['findings', scanId, category, severity],
    queryFn: () => {
      let url = `/scans/${scanId}/findings?`;
      if (category) url += `category=${category}&`;
      if (severity) url += `severity=${severity}&`;
      return apiClient.get<any[]>(url);
    },
    enabled: !!scanId,
  });
}

export function useCreateScan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateScanInput | FormData) => {
      return apiClient.post<any>('/scans', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scans'] });
    },
  });
}

export function useCancelScan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => {
      return apiClient.post<any>(`/scans/${id}/cancel`);
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['scan', id] });
      queryClient.invalidateQueries({ queryKey: ['scans'] });
    },
  });
}

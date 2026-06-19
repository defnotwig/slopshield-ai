import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useRouter } from "next/navigation";

export function useMe() {
  const token =
    typeof window !== "undefined"
      ? localStorage.getItem("slopshield_token")
      : null;
  return useQuery({
    queryKey: ["me"],
    queryFn: () => apiClient.get<any>("/auth/me"),
    enabled: !!token,
    retry: false,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: (data: any) =>
      apiClient.post<{ accessToken: string; user: any }>("/auth/login", data),
    onSuccess: (res) => {
      localStorage.setItem("slopshield_token", res.accessToken);
      queryClient.setQueryData(["me"], res.user);
      router.push("/dashboard");
    },
  });
}

export function useRegister() {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: (data: any) =>
      apiClient.post<{ accessToken: string; user: any }>(
        "/auth/register",
        data,
      ),
    onSuccess: (res) => {
      localStorage.setItem("slopshield_token", res.accessToken);
      queryClient.setQueryData(["me"], res.user);
      router.push("/dashboard");
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  const router = useRouter();

  return () => {
    localStorage.removeItem("slopshield_token");
    queryClient.setQueryData(["me"], null);
    queryClient.clear();
    router.push("/auth/login");
  };
}

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useRouter } from "next/navigation";

/** Browser-storage keys for the issued auth tokens. */
const ACCESS_TOKEN_KEY = "slopshield_token";
const REFRESH_TOKEN_KEY = "slopshield_refresh_token";

/** Shape returned by the API for login/register (Req 1.1, 1.2). */
interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: any;
}

/**
 * Persist both the access and refresh tokens (Req 1.8).
 *
 * If browser storage rejects the write (quota exceeded, private-mode
 * restrictions, disabled storage), this throws so the caller can treat the
 * login as failed rather than proceeding as authenticated (Req 1.8a). Any
 * partially written token is rolled back so we never leave half a session
 * behind.
 */
function persistTokens(accessToken: string, refreshToken: string): void {
  try {
    localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
    localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  } catch (cause) {
    // Roll back any partial write so an expired/empty session is not left behind.
    try {
      localStorage.removeItem(ACCESS_TOKEN_KEY);
      localStorage.removeItem(REFRESH_TOKEN_KEY);
    } catch {
      // Ignore cleanup failures — storage is already unusable.
    }
    throw new Error(
      "Unable to save your session. Your browser storage may be full or disabled.",
      { cause },
    );
  }
}

export function useMe() {
  const token =
    typeof window !== "undefined"
      ? localStorage.getItem(ACCESS_TOKEN_KEY)
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
    mutationFn: async (data: any) => {
      const res = await apiClient.post<AuthResponse>("/auth/login", data);
      // Persist inside the mutation so a storage failure rejects the mutation
      // and surfaces as an error instead of a silent authenticated state.
      persistTokens(res.accessToken, res.refreshToken);
      return res;
    },
    onSuccess: (res) => {
      queryClient.setQueryData(["me"], res.user);
      router.push("/dashboard");
    },
  });
}

export function useRegister() {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: async (data: any) => {
      const res = await apiClient.post<AuthResponse>("/auth/register", data);
      persistTokens(res.accessToken, res.refreshToken);
      return res;
    },
    onSuccess: (res) => {
      queryClient.setQueryData(["me"], res.user);
      router.push("/dashboard");
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  const router = useRouter();

  return () => {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    queryClient.setQueryData(["me"], null);
    queryClient.clear();
    router.push("/auth/login");
  };
}

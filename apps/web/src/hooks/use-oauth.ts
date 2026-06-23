import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";

export interface ConnectedAccount {
  provider: string;
  displayName: string;
  status: string;
  createdAt: string;
}

export interface GitHubRepo {
  id: number;
  full_name: string;
  private: boolean;
  html_url: string;
}

export function useConnectedAccounts() {
  return useQuery({
    queryKey: ["oauth", "accounts"],
    queryFn: () => apiClient.get<ConnectedAccount[]>("/oauth/accounts"),
  });
}

export function isGitHubConnected(accounts: ConnectedAccount[] | undefined): boolean {
  return (accounts ?? []).some(
    (a) => a.provider === "github" && a.status === "connected",
  );
}

export function useGitHubRepos(enabled: boolean) {
  return useQuery({
    queryKey: ["oauth", "github", "repos"],
    queryFn: () => apiClient.get<GitHubRepo[]>("/oauth/github/repos"),
    enabled,
  });
}

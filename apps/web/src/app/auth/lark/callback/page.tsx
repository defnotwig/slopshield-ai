"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

/** Must match the keys used in `use-auth.ts` so session state is consistent. */
const ACCESS_TOKEN_KEY = "slopshield_token";
const REFRESH_TOKEN_KEY = "slopshield_refresh_token";

export default function LarkCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const accessToken = searchParams.get("accessToken");
    const refreshToken = searchParams.get("refreshToken");
    const error = searchParams.get("error");

    // If error or missing tokens, redirect to login with error
    if (error || !accessToken || !refreshToken) {
      router.replace("/auth/login?error=lark_auth_failed");
      return;
    }

    // Persist tokens using the same mechanism as email/password login
    try {
      localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
      localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
    } catch {
      router.replace("/auth/login?error=storage");
      return;
    }

    // Strip tokens from URL for security
    globalThis.history.replaceState({}, "", "/auth/lark/callback");

    // Redirect to dashboard
    router.replace("/dashboard");
  }, [searchParams, router]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="w-8 h-8 animate-spin text-cyan-500" />
        <p className="text-sm text-muted-foreground">
          Completing Lark sign in...
        </p>
      </div>
    </div>
  );
}

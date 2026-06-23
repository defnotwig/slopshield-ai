"use client";

import React from "react";
import { usePathname, useRouter } from "next/navigation";
import { config } from "@/lib/config";

const LOGIN_ROUTE = "/auth/login";
const TOKEN_KEY = "slopshield_token";

/**
 * Returns true for routes that an unauthenticated user is allowed to view.
 * The auth surface (login/register) must stay reachable without a token,
 * otherwise the guard would redirect the login page to itself.
 */
export function isPublicRoute(pathname: string): boolean {
  return pathname.startsWith("/auth");
}

/** Reads the persisted access token from browser storage, if available. */
function hasStoredToken(): boolean {
  if (globalThis.window === undefined) {
    return false;
  }
  try {
    return Boolean(globalThis.localStorage.getItem(TOKEN_KEY));
  } catch {
    // If storage is unreadable, treat the user as unauthenticated.
    return false;
  }
}

/**
 * Redirects unauthenticated users away from protected routes (Req 1.13).
 *
 * In mock mode the app is a backend-less demo with no real authentication, so
 * the guard is a no-op there — consistent with the api-client, which only
 * performs the 401 redirect in live mode. In live mode, navigating to any
 * protected route without a stored token sends the user to the login route.
 */
export function RouteGuard({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  const router = useRouter();

  // In mock/demo mode there is no real session to protect.
  const guarded = !config.isMock && !isPublicRoute(pathname);

  // Track whether the client-side auth check has run so we don't flash
  // protected content during SSR/hydration before the token is known.
  const [checked, setChecked] = React.useState(false);

  React.useEffect(() => {
    if (!guarded) {
      setChecked(true);
      return;
    }

    if (!hasStoredToken()) {
      router.replace(LOGIN_ROUTE);
      return;
    }

    setChecked(true);
  }, [guarded, pathname, router]);

  // While a redirect is pending (or before the first client check), render
  // nothing for guarded routes so unauthenticated content never appears.
  if (guarded && !checked) {
    return null;
  }

  return <>{children}</>;
}

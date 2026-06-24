"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { RouteGuard } from "@/components/route-guard";

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAuthPage = pathname.startsWith("/auth");
  const [mobileOpen, setMobileOpen] = React.useState(false);

  // Close the mobile drawer whenever the route changes.
  React.useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Lock body scroll while the mobile drawer is open.
  React.useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mobileOpen]);

  if (isAuthPage) {
    return <div className="min-h-screen bg-background">{children}</div>;
  }

  return (
    <RouteGuard>
      <div className="min-h-screen flex bg-background">
        {/* Sidebar - fixed on desktop, slide-in drawer on mobile */}
        <Sidebar open={mobileOpen} onClose={() => setMobileOpen(false)} />

        {/* Mobile backdrop */}
        {mobileOpen && (
          <button
            type="button"
            aria-label="Close navigation menu"
            onClick={() => setMobileOpen(false)}
            className="fixed inset-0 z-20 bg-foreground/40 lg:hidden"
          />
        )}

        {/* Main Content Area */}
        <div className="flex-1 pl-0 lg:pl-64 flex flex-col min-w-0">
          <Header onMenuClick={() => setMobileOpen(true)} />
          <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-y-auto">
            {children}
          </main>
        </div>
      </div>
    </RouteGuard>
  );
}

"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { Bell, Menu, Search } from "lucide-react";

export function Header({ onMenuClick }: { readonly onMenuClick?: () => void }) {
  const pathname = usePathname();

  const getPageTitle = () => {
    if (pathname === "/") return "Home";
    if (pathname.startsWith("/dashboard")) return "Analytics Dashboard";
    if (pathname.startsWith("/scans/new")) return "Run New Code Scan";
    if (pathname.includes("/report")) return "Code Quality Report";
    if (pathname.includes("/progress")) return "Scan In Progress";
    if (pathname.startsWith("/scans")) return "Scan History";
    if (pathname.startsWith("/projects")) return "Projects";
    if (pathname.startsWith("/rules")) return "Rules Library";
    return "SlopShield AI";
  };

  return (
    <header className="h-16 border-b border-border bg-background flex items-center justify-between gap-4 px-4 sm:px-6 lg:px-8 sticky top-0 z-10 w-full">
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onMenuClick}
          aria-label="Open navigation menu"
          className="p-2 text-muted-foreground hover:bg-muted hover:text-foreground rounded-sm transition-colors border border-transparent hover:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 lg:hidden"
        >
          <Menu className="w-5 h-5" />
        </button>
        <h1 className="font-display text-xl sm:text-2xl font-bold uppercase tracking-wider text-foreground transition-colors truncate">
          {getPageTitle()}
        </h1>
      </div>

      <div className="flex items-center gap-4">
        {/* Search Bar */}
        <div className="relative w-64 hidden sm:block">
          <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search scans, rules..."
            className="w-full pl-9 pr-4 py-1.5 text-sm rounded-sm border border-border bg-muted/40 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring transition-all"
          />
        </div>

        {/* Notifications */}
        <button className="p-2 text-muted-foreground hover:bg-muted rounded-sm transition-colors relative border border-transparent hover:border-border">
          <Bell className="w-4.5 h-4.5" />
          <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-none bg-ring animate-pulse" />
        </button>
      </div>
    </header>
  );
}

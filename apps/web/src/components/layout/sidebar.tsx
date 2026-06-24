"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  PlusCircle,
  Search,
  FolderOpen,
  BookOpen,
  Settings,
  ShieldAlert,
  LogOut,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { useMe, useLogout } from "@/hooks/use-auth";
import { isSyntheticEmail } from "@/lib/user-utils";

export function Sidebar({
  open = false,
  onClose,
}: {
  readonly open?: boolean;
  readonly onClose?: () => void;
}) {
  const pathname = usePathname();
  const { data: user } = useMe();
  const logout = useLogout();

  const links = [
    { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    { name: "New Scan", href: "/scans/new", icon: PlusCircle },
    { name: "Scan History", href: "/scans", icon: Search },
    { name: "Projects", href: "/projects", icon: FolderOpen },
    { name: "Rules Library", href: "/rules", icon: BookOpen },
    { name: "Settings", href: "/profile", icon: Settings },
  ];

  const hasSyntheticEmail = isSyntheticEmail(user?.email);
  const displayName = hasSyntheticEmail
    ? user?.name || "User"
    : user?.name || user?.email || "User";
  const displayEmail = hasSyntheticEmail ? "" : user?.email || "";
  const initials = displayName.charAt(0).toUpperCase();

  return (
    <aside
      className={`w-64 fixed inset-y-0 left-0 z-30 flex flex-col border-r border-border bg-background transition-transform duration-200 ease-out shadow-xl lg:shadow-none lg:translate-x-0 ${
        open ? "translate-x-0" : "-translate-x-full"
      }`}
    >
      {/* Brand Header */}
      <div className="h-16 flex items-center px-6 border-b border-border">
        <Link href="/" className="flex items-center gap-3">
          <ShieldAlert className="w-6 h-6 text-ring" />
          <span className="font-display font-bold text-2xl tracking-wider text-foreground uppercase">
            SlopShield AI
          </span>
        </Link>
      </div>

      {/* Nav Links */}
      <nav className="flex-1 px-3 py-6 space-y-1 overflow-y-auto">
        <div className="px-3 mb-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Navigation
          </p>
        </div>
        {links.map((link) => {
          const isActive =
            pathname === link.href || pathname.startsWith(link.href + "/");
          const Icon = link.icon;
          return (
            <Link
              key={link.name}
              href={link.href}
              onClick={onClose}
              className={`flex items-center gap-3 px-3 py-2 text-sm font-medium transition-all rounded-sm border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
                isActive
                  ? "border-border bg-muted text-foreground border-l-ring border-l-2"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground border-transparent"
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{link.name}</span>
            </Link>
          );
        })}
      </nav>

      {/* Footer Controls */}
      <div className="p-4 border-t border-border space-y-3 bg-muted/20">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-sm bg-muted border border-border flex items-center justify-center text-foreground font-semibold text-xs uppercase">
              {initials}
            </div>
            <div className="truncate w-24">
              <p className="text-xs font-semibold text-foreground truncate">
                {displayName}
              </p>
              <p className="text-[10px] text-muted-foreground truncate">
                {displayEmail}
              </p>
            </div>
          </div>
          <ThemeToggle />
        </div>
        <button
          onClick={logout}
          className="flex items-center gap-2 w-full px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          aria-label="Log out"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>Log out</span>
        </button>
      </div>
    </aside>
  );
}

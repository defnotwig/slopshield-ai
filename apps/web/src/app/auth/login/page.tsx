"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useLogin } from "@/hooks/use-auth";
import { ShieldAlert, KeyRound, Mail, Loader2 } from "lucide-react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const loginMutation = useLogin();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    if (!email || !password) {
      setErr("Please fill in all fields.");
      return;
    }

    try {
      await loginMutation.mutateAsync({ email, password });
    } catch (e: any) {
      setErr(e.message || "Invalid email or password.");
    }
  };

  return (
    <div className="min-h-screen bg-grid-pattern bg-background flex items-center justify-center p-6 relative">
      <div className="w-full max-w-md bg-card border border-border p-8 space-y-6 rounded-sm">
        {/* Brand Header */}
        <div className="flex flex-col items-center text-center space-y-2">
          <div className="p-3 bg-muted border border-border rounded-sm text-foreground">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <h2 className="font-display text-3xl font-bold uppercase tracking-wider text-foreground">
            Access SlopShield AI
          </h2>
          <p className="text-xs text-muted-foreground">
            Authenticate to audit your codebase pipeline quality.
          </p>
        </div>

        {err && (
          <div className="p-3.5 rounded-sm bg-destructive/10 border border-destructive/20 text-xs font-semibold text-destructive text-center animate-shake">
            {err}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground block">
              Email Address
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-muted-foreground absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="email"
                placeholder="developer@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 text-sm rounded-sm border border-border bg-muted/40 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring transition-all"
                required
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground block">
              Password
            </label>
            <div className="relative">
              <KeyRound className="w-4 h-4 text-muted-foreground absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 text-sm rounded-sm border border-border bg-muted/40 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring transition-all"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loginMutation.isPending}
            className="w-full py-3 mt-2 font-bold rounded-sm bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50 disabled:pointer-events-none transition-all flex items-center justify-center gap-2"
          >
            {loginMutation.isPending && (
              <Loader2 className="w-4 h-4 animate-spin" />
            )}
            Sign In
          </button>
        </form>

        <div className="text-center text-xs text-muted-foreground">
          Don&apos;t have an account?{" "}
          <Link
            href="/auth/register"
            className="font-bold text-ring hover:text-ring/90"
          >
            Create account
          </Link>
        </div>
      </div>
    </div>
  );
}

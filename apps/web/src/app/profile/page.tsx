"use client";

import React, { useState, useEffect } from "react";
import { useMe } from "@/hooks/use-auth";
import { apiClient } from "@/lib/api-client";
import { isSyntheticEmail } from "@/lib/user-utils";
import {
  User,
  Mail,
  Shield,
  Calendar,
  Lock,
  Eye,
  EyeOff,
  Loader2,
  Check,
  AlertCircle,
  Github,
  MessageSquare,
  Link2,
  Unlink,
} from "lucide-react";

interface ConnectedAccount {
  provider: string;
  displayName: string;
  status: string;
  createdAt: string;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default function ProfilePage() {
  const { data: user, isLoading: userLoading, isError: userError } = useMe();

  // Password change state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState({ text: "", type: "" });
  const [passwordLoading, setPasswordLoading] = useState(false);

  // Connected accounts state
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [connectingProvider, setConnectingProvider] = useState<string | null>(null);
  const [disconnectingProvider, setDisconnectingProvider] = useState<string | null>(null);

  // Fetch connected accounts
  useEffect(() => {
    fetchConnectedAccounts();
  }, []);

  async function fetchConnectedAccounts() {
    try {
      setAccountsLoading(true);
      const data = await apiClient.get<ConnectedAccount[]>("/oauth/accounts");
      setAccounts(data || []);
    } catch {
      setAccounts([]);
    } finally {
      setAccountsLoading(false);
    }
  }

  // Password change handler
  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    setPasswordMsg({ text: "", type: "" });

    if (newPassword !== confirmPassword) {
      setPasswordMsg({ text: "New passwords do not match.", type: "error" });
      return;
    }

    if (newPassword.length < 8) {
      setPasswordMsg({ text: "New password must be at least 8 characters.", type: "error" });
      return;
    }

    setPasswordLoading(true);
    try {
      const res = await apiClient.put<{ accessToken: string; refreshToken: string }>(
        "/auth/password",
        { currentPassword, newPassword }
      );
      // Update stored tokens with the new pair
      localStorage.setItem("slopshield_token", res.accessToken);
      localStorage.setItem("slopshield_refresh_token", res.refreshToken);
      setPasswordMsg({ text: "Password changed successfully.", type: "success" });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      setPasswordMsg({
        text: err.message || "Failed to change password.",
        type: "error",
      });
    } finally {
      setPasswordLoading(false);
    }
  }

  // Connect OAuth provider
  async function handleConnect(provider: string) {
    setConnectingProvider(provider);
    try {
      const res = await apiClient.get<{ url: string }>(`/oauth/${provider}/authorize`);
      window.location.href = res.url;
    } catch {
      setConnectingProvider(null);
    }
  }

  // Disconnect OAuth provider
  async function handleDisconnect(provider: string) {
    setDisconnectingProvider(provider);
    try {
      await apiClient.delete(`/oauth/${provider}/disconnect`);
      await fetchConnectedAccounts();
    } catch {
      // silently fail
    } finally {
      setDisconnectingProvider(null);
    }
  }

  // Helper: get connected account for a provider
  function getAccount(provider: string): ConnectedAccount | undefined {
    return accounts.find((a) => a.provider === provider && a.status === "connected");
  }

  if (userLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 space-y-4">
        <Loader2 className="w-8 h-8 text-cyan-500 animate-spin" />
        <p className="text-sm font-mono text-muted-foreground">Loading profile...</p>
      </div>
    );
  }

  if (userError || !user) {
    return (
      <div className="max-w-md mx-auto py-24 text-center space-y-4">
        <div className="p-4 bg-red-500/10 text-red-500 rounded-full w-fit mx-auto border border-red-500/20">
          <AlertCircle className="w-8 h-8" />
        </div>
        <h3 className="text-lg font-bold text-foreground">Failed to load profile</h3>
        <p className="text-xs text-muted-foreground">
          Please check your connection and try again.
        </p>
      </div>
    );
  }

  const githubAccount = getAccount("github");
  const larkAccount = getAccount("lark");

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      {/* Page Header */}
      <div>
        <h2 className="text-xl font-bold text-foreground">Profile</h2>
        <p className="text-xs text-muted-foreground mt-1">
          View your account details, change your password, and manage connected accounts.
        </p>
      </div>

      {/* Account Info Section */}
      <div className="border border-border bg-card p-6 rounded-sm space-y-4">
        <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground border-b border-border pb-2.5 flex items-center gap-2">
          <User className="w-4 h-4 text-cyan-500" />
          Account Information
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-sm border border-border">
            <User className="w-4 h-4 text-muted-foreground shrink-0" />
            <div>
              <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">Name</p>
              <p className="text-sm font-medium text-foreground">{user.name || "—"}</p>
            </div>
          </div>

          <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-sm border border-border">
            <Mail className="w-4 h-4 text-muted-foreground shrink-0" />
            <div>
              <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">Email</p>
              <p className="text-sm font-medium text-foreground">{isSyntheticEmail(user?.email) ? "—" : user.email}</p>
            </div>
          </div>

          <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-sm border border-border">
            <Shield className="w-4 h-4 text-muted-foreground shrink-0" />
            <div>
              <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">Role</p>
              <p className="text-sm font-medium text-foreground capitalize">{user.role || "user"}</p>
            </div>
          </div>

          <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-sm border border-border">
            <Calendar className="w-4 h-4 text-muted-foreground shrink-0" />
            <div>
              <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">Member Since</p>
              <p className="text-sm font-medium text-foreground">
                {user.createdAt ? formatDate(user.createdAt) : "—"}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Change Password Section */}
      <div className="border border-border bg-card p-6 rounded-sm space-y-4">
        <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground border-b border-border pb-2.5 flex items-center gap-2">
          <Lock className="w-4 h-4 text-cyan-500" />
          Change Password
        </h3>

        {passwordMsg.text && (
          <div
            className={`p-3 rounded-sm text-xs font-bold flex gap-2 items-center ${
              passwordMsg.type === "success"
                ? "bg-green-500/10 border border-green-500/20 text-green-500"
                : "bg-red-500/10 border border-red-500/20 text-red-500"
            }`}
          >
            {passwordMsg.type === "success" ? (
              <Check className="w-4 h-4 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0" />
            )}
            {passwordMsg.text}
          </div>
        )}

        <form onSubmit={handlePasswordChange} className="space-y-4">
          {/* Current Password */}
          <div className="space-y-1.5">
            <label htmlFor="current-password" className="text-xs font-bold text-muted-foreground uppercase tracking-wider block">
              Current Password
            </label>
            <div className="relative">
              <input
                id="current-password"
                type={showCurrentPassword ? "text" : "password"}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                className="w-full px-3 py-2 text-sm rounded-sm border border-border bg-muted/30 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring pr-10"
                placeholder="Enter current password"
              />
              <button
                type="button"
                onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label={showCurrentPassword ? "Hide password" : "Show password"}
              >
                {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* New Password */}
          <div className="space-y-1.5">
            <label htmlFor="new-password" className="text-xs font-bold text-muted-foreground uppercase tracking-wider block">
              New Password
            </label>
            <div className="relative">
              <input
                id="new-password"
                type={showNewPassword ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
                className="w-full px-3 py-2 text-sm rounded-sm border border-border bg-muted/30 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring pr-10"
                placeholder="Enter new password (min 8 characters)"
              />
              <button
                type="button"
                onClick={() => setShowNewPassword(!showNewPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label={showNewPassword ? "Hide password" : "Show password"}
              >
                {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Confirm Password */}
          <div className="space-y-1.5">
            <label htmlFor="confirm-password" className="text-xs font-bold text-muted-foreground uppercase tracking-wider block">
              Confirm New Password
            </label>
            <input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={8}
              className="w-full px-3 py-2 text-sm rounded-sm border border-border bg-muted/30 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder="Re-enter new password"
            />
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={passwordLoading}
              className="inline-flex items-center gap-1.5 px-5 py-2.5 text-xs font-bold rounded-sm bg-cyan-500 text-gray-950 hover:bg-cyan-400 disabled:opacity-50 transition-all shadow-md shadow-cyan-500/20"
            >
              {passwordLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Lock className="w-4 h-4" />
              )}
              Update Password
            </button>
          </div>
        </form>
      </div>

      {/* Connected Accounts Section */}
      <div className="border border-border bg-card p-6 rounded-sm space-y-4">
        <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground border-b border-border pb-2.5 flex items-center gap-2">
          <Link2 className="w-4 h-4 text-cyan-500" />
          Connected Accounts
        </h3>

        {accountsLoading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="w-5 h-5 text-cyan-500 animate-spin" />
          </div>
        ) : (
          <div className="space-y-3">
            {/* GitHub Row */}
            <div className="flex items-center justify-between p-4 bg-muted/30 rounded-sm border border-border">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-sm bg-muted border border-border">
                  <Github className="w-5 h-5 text-foreground" />
                </div>
                <div>
                  <p className="text-sm font-bold text-foreground">GitHub</p>
                  {githubAccount ? (
                    <p className="text-xs text-muted-foreground">
                      Connected as <span className="font-medium text-foreground">{githubAccount.displayName}</span>
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">Not connected</p>
                  )}
                </div>
              </div>
              {githubAccount ? (
                <button
                  onClick={() => handleDisconnect("github")}
                  disabled={disconnectingProvider === "github"}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-sm border border-red-500/30 text-red-500 hover:bg-red-500/10 disabled:opacity-50 transition-colors"
                >
                  {disconnectingProvider === "github" ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Unlink className="w-3.5 h-3.5" />
                  )}
                  Disconnect
                </button>
              ) : (
                <button
                  onClick={() => handleConnect("github")}
                  disabled={connectingProvider === "github"}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-sm border border-border text-foreground hover:bg-muted/50 disabled:opacity-50 transition-colors"
                >
                  {connectingProvider === "github" ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Github className="w-3.5 h-3.5" />
                  )}
                  Connect GitHub
                </button>
              )}
            </div>

            {/* Lark Row */}
            <div className="flex items-center justify-between p-4 bg-muted/30 rounded-sm border border-border">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-sm bg-muted border border-border">
                  <MessageSquare className="w-5 h-5 text-foreground" />
                </div>
                <div>
                  <p className="text-sm font-bold text-foreground">Lark</p>
                  {larkAccount ? (
                    <p className="text-xs text-muted-foreground">
                      Connected as <span className="font-medium text-foreground">{larkAccount.displayName}</span>
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">Not connected</p>
                  )}
                </div>
              </div>
              {larkAccount ? (
                <button
                  onClick={() => handleDisconnect("lark")}
                  disabled={disconnectingProvider === "lark"}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-sm border border-red-500/30 text-red-500 hover:bg-red-500/10 disabled:opacity-50 transition-colors"
                >
                  {disconnectingProvider === "lark" ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Unlink className="w-3.5 h-3.5" />
                  )}
                  Disconnect
                </button>
              ) : (
                <button
                  onClick={() => handleConnect("lark")}
                  disabled={connectingProvider === "lark"}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-sm border border-border text-foreground hover:bg-muted/50 disabled:opacity-50 transition-colors"
                >
                  {connectingProvider === "lark" ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <MessageSquare className="w-3.5 h-3.5" />
                  )}
                  Connect Lark
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import React, { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  useProject,
  useUpdateProject,
  useDeleteProject,
} from "@/hooks/use-projects";
import {
  useProjectMembers,
  useAddProjectMember,
  useRemoveProjectMember,
} from "@/hooks/use-notifications";
import {
  ArrowLeft,
  Save,
  Trash2,
  ShieldAlert,
  Loader2,
  AlertCircle,
  Check,
  Users,
  UserMinus,
  UserPlus,
} from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";

export default function ProjectSettingsPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;

  const { data: project, isLoading, isError, refetch } = useProject(projectId);
  const updateMutation = useUpdateProject();
  const deleteMutation = useDeleteProject();

  const {
    data: members,
    isLoading: membersLoading,
    refetch: refetchMembers,
  } = useProjectMembers(projectId);
  const addMemberMutation = useAddProjectMember();
  const removeMemberMutation = useRemoveProjectMember();

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [inviteMsg, setInviteMsg] = useState({ text: "", type: "" });

  const [name, setName] = useState("");
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [framework, setFramework] = useState("");
  const [minimumScore, setMinimumScore] = useState(80);
  const [larkChatId, setLarkChatId] = useState("");
  const [teamLeadLarkId, setTeamLeadLarkId] = useState("");

  const [msg, setMsg] = useState({ text: "", type: "" });
  const [memberToRemove, setMemberToRemove] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const roleBadgeClass = (role: string) => {
    if (role === "admin")
      return "bg-red-500/10 border border-red-500/20 text-red-500";
    if (role === "lead")
      return "bg-yellow-500/10 border border-yellow-500/20 text-yellow-500";
    return "bg-cyan-500/10 border border-cyan-500/20 text-cyan-500";
  };

  useEffect(() => {
    if (project) {
      setName(project.name || "");
      setRepositoryUrl(project.repositoryUrl || "");
      setFramework(project.framework || "");
      setMinimumScore(project.minimumScore ?? 80);
      setLarkChatId(project.larkChatId || "");
      setTeamLeadLarkId(project.teamLeadLarkId || "");
    }
  }, [project]);

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteMsg({ text: "", type: "" });
    if (!inviteEmail) return;

    try {
      await addMemberMutation.mutateAsync({
        projectId,
        email: inviteEmail,
        role: inviteRole,
      });
      setInviteEmail("");
      setInviteMsg({
        text: "Workspace collaborator added successfully.",
        type: "success",
      });
      refetchMembers();
    } catch (err: any) {
      setInviteMsg({
        text: err.message || "Failed to add member.",
        type: "error",
      });
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    try {
      await removeMemberMutation.mutateAsync({ projectId, memberId });
      refetchMembers();
    } catch (err: any) {
      setInviteMsg({
        text: err.message || "Failed to remove member.",
        type: "error",
      });
    } finally {
      setMemberToRemove(null);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg({ text: "", type: "" });
    try {
      await updateMutation.mutateAsync({
        id: projectId,
        data: {
          name,
          repositoryUrl: repositoryUrl || null,
          framework: framework || null,
          minimumScore: Number(minimumScore),
          larkChatId: larkChatId || null,
          teamLeadLarkId: teamLeadLarkId || null,
        },
      });
      setMsg({
        text: "Project settings updated successfully.",
        type: "success",
      });
      refetch();
    } catch (err: any) {
      setMsg({
        text: err.message || "Failed to save settings.",
        type: "error",
      });
    }
  };

  const handleDelete = async () => {
    try {
      await deleteMutation.mutateAsync(projectId);
      router.push("/projects");
    } catch (err: any) {
      setMsg({
        text: err.message || "Failed to delete project.",
        type: "error",
      });
    } finally {
      setDeleteOpen(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 space-y-4">
        <Loader2 className="w-8 h-8 text-ring animate-spin" />
        <p className="text-sm font-mono text-muted-foreground">
          Retrieving configuration settings...
        </p>
      </div>
    );
  }

  if (isError || !project) {
    return (
      <div className="max-w-md mx-auto py-24 text-center space-y-4">
        <div className="p-4 bg-destructive/10 text-destructive rounded-full w-fit mx-auto border border-destructive/20">
          <AlertCircle className="w-8 h-8" />
        </div>
        <h3 className="text-lg font-bold">Failed to load configuration</h3>
        <p className="text-xs text-muted-foreground">
          The project was not found in the database.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      {/* Title */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => router.push("/projects")}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-muted-foreground hover:text-foreground transition-colors uppercase tracking-wider"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Projects
        </button>

        <button
          onClick={() => setDeleteOpen(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-sm border border-destructive/30 text-destructive hover:bg-destructive hover:text-destructive-foreground transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <Trash2 className="w-4 h-4" />
          Delete Project
        </button>
      </div>

      <div>
        <h2 className="text-xl font-bold text-foreground">
          Project Settings
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          Configure security triggers, minimum thresholds, and team notification
          preferences for <strong>{project.name}</strong>.
        </p>
      </div>

      {msg.text && (
        <div
          className={`p-4 rounded-sm text-xs font-bold flex gap-2 items-center ${
            msg.type === "success"
              ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400"
              : "bg-destructive/10 border border-destructive/20 text-destructive"
          }`}
        >
          {msg.type === "success" ? (
            <Check className="w-4.5 h-4.5" />
          ) : (
            <AlertCircle className="w-4.5 h-4.5" />
          )}
          {msg.text}
        </div>
      )}

      {/* Configuration Form */}
      <div className="bg-card border border-border p-8 rounded-sm">
        <form onSubmit={handleSave} className="space-y-6">
          <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground border-b border-border pb-2.5">
            General Properties
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-1">
              <label
                htmlFor="ps-name"
                className="text-xs font-bold text-muted-foreground uppercase tracking-wider block"
              >
                Project Name *
              </label>
              <input
                id="ps-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3.5 py-2 text-sm rounded-sm border border-border bg-muted/40 text-foreground focus:outline-none focus:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                required
              />
            </div>

            <div className="space-y-1">
              <label
                htmlFor="ps-framework"
                className="text-xs font-bold text-muted-foreground uppercase tracking-wider block"
              >
                Framework / Environment
              </label>
              <input
                id="ps-framework"
                type="text"
                value={framework}
                onChange={(e) => setFramework(e.target.value)}
                className="w-full px-3.5 py-2 text-sm rounded-sm border border-border bg-muted/40 text-foreground focus:outline-none focus:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label
              htmlFor="ps-repo-url"
              className="text-xs font-bold text-muted-foreground uppercase tracking-wider block"
            >
              Repository HTTPS URL
            </label>
            <input
              id="ps-repo-url"
              type="text"
              value={repositoryUrl}
              onChange={(e) => setRepositoryUrl(e.target.value)}
              className="w-full px-3.5 py-2 text-sm rounded-sm border border-border bg-muted/40 text-foreground focus:outline-none focus:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          </div>

          <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground border-b border-border pt-4 pb-2.5">
            Audit Quality Rules
          </h3>

          <div className="space-y-2.5">
            <label
              htmlFor="ps-min-score"
              className="text-xs font-bold text-muted-foreground uppercase tracking-wider block"
            >
              Minimum Pass Score Verdict (0 - 100)
            </label>
            <div className="flex items-center gap-4">
              <input
                id="ps-min-score"
                type="number"
                min="0"
                max="100"
                value={minimumScore}
                onChange={(e) => setMinimumScore(Number(e.target.value))}
                className="w-24 px-3 py-2 text-sm rounded-sm border border-border bg-muted/40 text-foreground focus:outline-none focus:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
              />
              <span className="text-xs text-muted-foreground">
                Scans scoring below this value are flagged as Risky or Blocked
                automatically.
              </span>
            </div>
          </div>

          <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground border-b border-border pt-4 pb-2.5">
            Lark Bot Chat Notifications
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-1">
              <label
                htmlFor="ps-lark-chat"
                className="text-xs font-bold text-muted-foreground uppercase tracking-wider block"
              >
                Lark Chat ID
              </label>
              <input
                id="ps-lark-chat"
                type="text"
                placeholder="oc_xxxxxxxxxxxxxxxx"
                value={larkChatId}
                onChange={(e) => setLarkChatId(e.target.value)}
                className="w-full px-3.5 py-2 text-sm rounded-sm border border-border bg-muted/40 text-foreground focus:outline-none focus:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
              />
            </div>

            <div className="space-y-1">
              <label
                htmlFor="ps-lark-lead"
                className="text-xs font-bold text-muted-foreground uppercase tracking-wider block"
              >
                Team Lead Lark User ID
              </label>
              <input
                id="ps-lark-lead"
                type="text"
                placeholder="ou_xxxxxxxxxxxxxxxx"
                value={teamLeadLarkId}
                onChange={(e) => setTeamLeadLarkId(e.target.value)}
                className="w-full px-3.5 py-2 text-sm rounded-sm border border-border bg-muted/40 text-foreground focus:outline-none focus:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
              />
            </div>
          </div>

          <div className="border-t border-border pt-6 flex justify-end">
            <button
              type="submit"
              disabled={updateMutation.isPending}
              className="inline-flex items-center gap-1.5 px-6 py-3 font-bold rounded-sm bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {updateMutation.isPending ? (
                <Loader2 className="w-4.5 h-4.5 animate-spin" />
              ) : (
                <Save className="w-4.5 h-4.5" />
              )}
              Save Settings
            </button>
          </div>
        </form>
      </div>

      {/* Workspace Sharing & Team Collaborators */}
      <div className="bg-card border border-border p-8 rounded-sm space-y-6">
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground border-b border-border pb-2.5 flex items-center gap-2">
            <Users className="w-4 h-4 text-ring" />
            Workspace Sharing & Team Collaborators
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            Authorize other developers and engineers to access quality metrics,
            findings logs, and receive alerts for this project workspace.
          </p>
        </div>

        {inviteMsg.text && (
          <div
            className={`p-4 rounded-sm text-xs font-bold flex gap-2 items-center ${
              inviteMsg.type === "success"
                ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400"
                : "bg-destructive/10 border border-destructive/20 text-destructive"
            }`}
          >
            {inviteMsg.type === "success" ? (
              <Check className="w-4.5 h-4.5" />
            ) : (
              <AlertCircle className="w-4.5 h-4.5" />
            )}
            {inviteMsg.text}
          </div>
        )}

        <form
          onSubmit={handleAddMember}
          className="flex gap-4 items-end bg-muted/40 p-4 rounded-sm border border-border"
        >
          <div className="flex-1 space-y-1">
            <label
              htmlFor="ps-invite-email"
              className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block"
            >
              Collaborator Email Address
            </label>
            <input
              id="ps-invite-email"
              type="email"
              placeholder="engineer@company.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-sm border border-border bg-muted/40 text-foreground focus:outline-none focus:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
              required
            />
          </div>

          <div className="w-36 space-y-1">
            <label
              htmlFor="ps-invite-role"
              className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block"
            >
              Workspace Role
            </label>
            <select
              id="ps-invite-role"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-sm border border-border bg-muted/40 text-foreground focus:outline-none focus:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <option value="member">Member</option>
              <option value="lead">Lead</option>
              <option value="admin">Admin</option>
            </select>
          </div>

          <button
            type="submit"
            disabled={addMemberMutation.isPending}
            className="px-4 py-2 text-xs font-bold rounded-sm bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50 flex items-center gap-1.5 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 h-8"
          >
            {addMemberMutation.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <UserPlus className="w-3.5 h-3.5" />
            )}
            Add Collaborator
          </button>
        </form>

        <div className="space-y-2">
          <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
            Active Collaborators ({members?.length || 0})
          </h4>

          {membersLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="w-6 h-6 animate-spin text-ring" />
            </div>
          ) : !members || members.length === 0 ? (
            <p className="text-xs italic text-muted-foreground py-4 text-center border border-dashed border-border rounded-sm">
              No additional workspace collaborators configured. Add members
              above to share dashboard access.
            </p>
          ) : (
            <div className="border border-border rounded-sm overflow-hidden">
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-muted/40 border-b border-border text-[10px] uppercase font-bold text-muted-foreground">
                    <th className="px-4 py-2.5">Name</th>
                    <th className="px-4 py-2.5">Email</th>
                    <th className="px-4 py-2.5">Role</th>
                    <th className="px-4 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border text-xs">
                  {members.map((member) => (
                    <tr
                      key={member.id}
                      className="hover:bg-muted/50 text-foreground"
                    >
                      <td className="px-4 py-3 font-semibold">
                        {member.user.name}
                      </td>
                      <td className="px-4 py-3 font-mono">
                        {member.user.email}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${roleBadgeClass(
                            member.role,
                          )}`}
                        >
                          {member.role}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => setMemberToRemove(member.id)}
                          disabled={removeMemberMutation.isPending}
                          className="p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                          title="Remove Collaborator"
                        >
                          <UserMinus className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
              <div className="md:hidden divide-y divide-border">
                {members.map((member) => (
                  <div key={member.id + "-card"} className="p-4 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-foreground text-sm">
                        {member.user.name}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${roleBadgeClass(
                          member.role,
                        )}`}
                      >
                        {member.role}
                      </span>
                    </div>
                    <p className="font-mono text-xs text-muted-foreground break-all">
                      {member.user.email}
                    </p>
                    <button
                      onClick={() => setMemberToRemove(member.id)}
                      disabled={removeMemberMutation.isPending}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-destructive hover:bg-destructive/10 px-2 py-1 rounded-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                      <UserMinus className="w-3.5 h-3.5" />
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        destructive
        title="Delete this project?"
        description="This permanently removes the project and all related scan logs. This action cannot be undone."
        confirmLabel="Delete Project"
        loading={deleteMutation.isPending}
        onConfirm={handleDelete}
        onCancel={() => setDeleteOpen(false)}
      />

      <ConfirmDialog
        open={memberToRemove !== null}
        destructive
        title="Remove collaborator?"
        description="They will lose access to this project workspace, its findings, and alerts."
        confirmLabel="Remove"
        loading={removeMemberMutation.isPending}
        onConfirm={() => memberToRemove && handleRemoveMember(memberToRemove)}
        onCancel={() => setMemberToRemove(null)}
      />
    </div>
  );
}

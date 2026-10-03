"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast/ToastContext";
import { useI18n } from "@/context/LanguageContext";
import { PROFILE_LIMITS, validateNewPassword } from "@/lib/profileValidation";

type UserRole = "user" | "moderator" | "admin";
type AccountStatus = "active" | "suspended" | "deleted";

type ManagedUser = {
  id: number;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  accountStatus: AccountStatus;
  deletedAt?: string;
};

type AdminSummary = {
  totalUsers: number;
  activeUsers: number;
  suspendedUsers: number;
  deletedUsers: number;
  activeListings: number;
  completedOrders: number;
  completedRevenue: number;
};

type UserForm = {
  username: string;
  email: string;
  firstName: string;
  lastName: string;
};

type CreateUserForm = UserForm & {
  password: string;
  role: UserRole;
};

type MLTrainingRun = {
  id: number;
  requestedBy?: number;
  requestedByRole: "moderator" | "admin";
  status: "queued" | "running" | "succeeded" | "failed";
  progress: number;
  stage: string;
  syntheticRows: number;
  surveyRows: number;
  totalRows: number;
  modelVersion?: string;
  artifactSha256?: string;
  errorMessage?: string;
  isActive: boolean;
  createdAt: string;
  finishedAt?: string;
};

type MLStatus = {
  syntheticRows: number;
  surveyRows: number;
  totalRows: number;
  activeModel: {
    version?: string;
    trainedAt?: string;
    artifactSha256?: string;
  };
  activeRun: MLTrainingRun | null;
};

type MLFeedback = {
  id: number;
  orderId: number;
  source: "transaction_survey";
  age_group: string;
  gender: string;
  experience_level: string;
  play_style: string;
  budget_range: string;
  weightCategory: string;
  flexibilityCategory: string;
  balanceCategory: string;
  createdAt: string;
};

const emptyCreateForm: CreateUserForm = {
  username: "",
  email: "",
  password: "",
  firstName: "",
  lastName: "",
  role: "user",
};

const cellClass = "px-3 py-3 text-left border-b border-[#eee] align-top";
const inputClass = "w-full min-w-[130px] px-2 py-2 border border-[#ccc] rounded-md";
const primaryButtonClass = "px-3 py-2 border-0 rounded-md bg-[#2457d6] text-white cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";
const dangerButtonClass = "px-3 py-2 border-0 rounded-md bg-[#b42318] text-white cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";
const neutralButtonClass = "px-3 py-2 border border-[#bbb] rounded-md bg-white text-[#222] cursor-pointer";
const summaryCardClass = "p-[18px] bg-white rounded-[10px] shadow-[var(--shadow)] flex flex-col gap-1.5";
const summaryLabelClass = "text-[#666] text-[.9rem]";
const summaryValueClass = "text-[1.45rem]";

export default function AdminUsersPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const { t } = useI18n();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [viewerRole, setViewerRole] = useState<UserRole | null>(null);
  const [viewerUsername, setViewerUsername] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"" | AccountStatus>("");
  const [role, setRole] = useState<"" | UserRole>("");
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<CreateUserForm>(emptyCreateForm);
  const [editingID, setEditingID] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<UserForm | null>(null);
  const [busyID, setBusyID] = useState<number | null>(null);
  const [mlStatus, setMLStatus] = useState<MLStatus | null>(null);
  const [mlRuns, setMLRuns] = useState<MLTrainingRun[]>([]);
  const [mlFeedback, setMLFeedback] = useState<MLFeedback[]>([]);
  const [mlBusy, setMLBusy] = useState(false);

  const adminFetch = useCallback(async (url: string, init?: RequestInit) => {
    // Database moderators/admins use the ordinary login flow and token. The
    // separate adminToken remains the bootstrap administrator credential.
    const token = localStorage.getItem("adminToken") ?? localStorage.getItem("token");
    if (!token) {
      router.replace("/admin/login");
      throw new Error(t("admin.loginRequired"));
    }
    const response = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...init?.headers,
      },
    });
    if (response.status === 401) {
      localStorage.removeItem("adminToken");
      router.replace("/admin/login");
    }
    return response;
  }, [router, t]);

  const loadUsers = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (status) params.set("status", status);
      if (role) params.set("role", role);
      const suffix = params.size ? `?${params.toString()}` : "";
      const response = await adminFetch(`/api/v1/admin/users${suffix}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? t("admin.loadUsersFailed"));
      setUsers(data.users ?? []);
      setViewerRole(data.viewerRole ?? null);
      setViewerUsername(typeof data.viewerUsername === "string" ? data.viewerUsername : "");
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.networkError"));
    }
  }, [adminFetch, role, search, status, t]);

  const loadSummary = useCallback(async () => {
    try {
      const response = await adminFetch("/api/v1/admin/summary");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? t("admin.loadSummaryFailed"));
      setSummary(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.networkError"));
    }
  }, [adminFetch, t]);

  const loadMLData = useCallback(async () => {
    try {
      const [statusResponse, runsResponse, feedbackResponse] = await Promise.all([
        adminFetch("/api/v1/admin/ml/status"),
        adminFetch("/api/v1/admin/ml/runs"),
        adminFetch("/api/v1/admin/ml/feedback"),
      ]);
      const [statusData, runsData, feedbackData] = await Promise.all([
        statusResponse.json(),
        runsResponse.json(),
        feedbackResponse.json(),
      ]);
      if (!statusResponse.ok || !runsResponse.ok || !feedbackResponse.ok) {
        throw new Error(
          statusData.error
          ?? runsData.error
          ?? feedbackData.error
          ?? t("admin.mlLoadFailed"),
        );
      }
      setMLStatus(statusData);
      setMLRuns(runsData.runs ?? []);
      setMLFeedback(feedbackData.feedback ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.mlLoadFailed"));
    }
  }, [adminFetch, t]);

  useEffect(() => { void loadUsers(); }, [loadUsers]);
  useEffect(() => { void loadSummary(); }, [loadSummary]);
  useEffect(() => { void loadMLData(); }, [loadMLData]);
  useEffect(() => {
    if (!mlStatus?.activeRun) return;
    const interval = window.setInterval(() => { void loadMLData(); }, 1000);
    return () => window.clearInterval(interval);
  }, [loadMLData, mlStatus?.activeRun?.id]);

  const reportMutationError = (err: unknown) => {
    const message = err instanceof Error ? err.message : t("admin.updateFailed");
    setError(message);
    showToast(message, "error");
  };

  const changeStatus = async (user: ManagedUser) => {
    const accountStatus = user.accountStatus === "active" ? "suspended" : "active";
    setBusyID(user.id);
    try {
      const response = await adminFetch(`/api/v1/admin/users/${user.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ accountStatus }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? t("admin.updateFailed"));
      setUsers((current) => current.map((item) => item.id === user.id ? { ...item, accountStatus } : item));
      showToast(
        accountStatus === "suspended"
          ? t("toast.accountSuspended", { name: user.username })
          : t("toast.accountRestored", { name: user.username }),
        "success",
      );
      void loadSummary();
    } catch (err) {
      reportMutationError(err);
    } finally {
      setBusyID(null);
    }
  };

  const changeRole = async (user: ManagedUser, nextRole: UserRole) => {
    setBusyID(user.id);
    try {
      const response = await adminFetch(`/api/v1/admin/users/${user.id}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role: nextRole }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? t("admin.updateFailed"));
      setUsers((current) => current.map((item) => item.id === user.id ? { ...item, role: nextRole } : item));
      showToast(t("admin.roleUpdated"), "success");
    } catch (err) {
      reportMutationError(err);
    } finally {
      setBusyID(null);
    }
  };

  const beginEdit = (user: ManagedUser) => {
    setEditingID(user.id);
    setEditForm({
      username: user.username,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    });
  };

  const saveEdit = async (userID: number) => {
    if (!editForm) return;
    setBusyID(userID);
    try {
      const response = await adminFetch(`/api/v1/admin/users/${userID}`, {
        method: "PATCH",
        body: JSON.stringify(editForm),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? t("admin.updateFailed"));
      setUsers((current) => current.map((item) => item.id === userID ? data : item));
      setEditingID(null);
      setEditForm(null);
      showToast(t("admin.userUpdated"), "success");
    } catch (err) {
      reportMutationError(err);
    } finally {
      setBusyID(null);
    }
  };

  const createUser = async (event: FormEvent) => {
    event.preventDefault();
    const passwordProblem = validateNewPassword(createForm.password, createForm.username);
    if (passwordProblem) {
      showToast(t(passwordProblem), "error");
      return;
    }
    setBusyID(0);
    try {
      const response = await adminFetch("/api/v1/admin/users", {
        method: "POST",
        body: JSON.stringify(createForm),
      });
      const data = await response.json().catch(() => null);
      if (response.status === 403 && !data) throw new Error(t("validation.passwordBlocked"));
      if (!response.ok) throw new Error(data?.error ?? t("admin.createFailed"));
      setCreateForm(emptyCreateForm);
      setShowCreate(false);
      showToast(t("admin.userCreated"), "success");
      await Promise.all([loadUsers(), loadSummary()]);
    } catch (err) {
      reportMutationError(err);
    } finally {
      setBusyID(null);
    }
  };

  const deleteUser = async (user: ManagedUser) => {
    if (!window.confirm(t("admin.deleteConfirm", { name: user.username }))) return;
    setBusyID(user.id);
    try {
      const response = await adminFetch(`/api/v1/admin/users/${user.id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? t("admin.deleteFailed"));
      showToast(t("admin.userDeleted"), "success");
      await Promise.all([loadUsers(), loadSummary()]);
    } catch (err) {
      reportMutationError(err);
    } finally {
      setBusyID(null);
    }
  };

  const startRetraining = async () => {
    setMLBusy(true);
    try {
      const response = await adminFetch("/api/v1/admin/ml/retrain", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? t("admin.mlRetrainFailed"));
      showToast(t("admin.mlRetrainQueued"), "success");
      await loadMLData();
    } catch (err) {
      reportMutationError(err);
    } finally {
      setMLBusy(false);
    }
  };

  const logout = () => {
    localStorage.removeItem("adminToken");
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    void fetch("/api/v1/auth/logout", { method: "POST", credentials: "include" });
    router.push("/admin/login");
  };

  const isAdmin = viewerRole === "admin";

  return (
    <main className="min-h-screen bg-[#f4f5f7] p-10 max-[700px]:px-3 max-[700px]:py-5">
      <div className="max-w-[1250px] mx-auto mb-6 flex items-center justify-between gap-5 max-[700px]:items-start">
        <div>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="m-0">{t("admin.userManagement")}</h1>
            {viewerUsername && viewerRole && (
              <p className="m-0 text-[#555] text-base font-medium">
                {t("admin.welcomeBack", { name: viewerUsername })}
                <span className="text-[#888] font-normal">
                  {" · "}
                  {t(`admin.role${viewerRole[0].toUpperCase()}${viewerRole.slice(1)}`)}
                </span>
              </p>
            )}
          </div>
          <p>{isAdmin ? t("admin.adminDescription") : t("admin.moderatorDescription")}</p>
        </div>
        <div className="flex gap-2">
          {isAdmin && <button onClick={() => setShowCreate((value) => !value)} className={primaryButtonClass}>{t("admin.addUser")}</button>}
          <button onClick={logout} className={neutralButtonClass}>{t("admin.logout")}</button>
        </div>
      </div>

      {error && <p className="text-[#b42318] max-w-[1250px] mx-auto mb-4">{error}</p>}

      {summary && (
        <section className="max-w-[1250px] mx-auto mb-5 grid grid-cols-4 gap-[14px] max-[900px]:grid-cols-2" aria-label={t("admin.marketplaceSummary")}>
          <div className={summaryCardClass}><span className={summaryLabelClass}>{t("admin.totalUsers")}</span><strong className={summaryValueClass}>{summary.totalUsers}</strong></div>
          <div className={summaryCardClass}><span className={summaryLabelClass}>{t("admin.activeUsers")}</span><strong className={summaryValueClass}>{summary.activeUsers}</strong></div>
          <div className={summaryCardClass}><span className={summaryLabelClass}>{t("admin.suspendedUsers")}</span><strong className={summaryValueClass}>{summary.suspendedUsers}</strong></div>
          <div className={summaryCardClass}><span className={summaryLabelClass}>{t("admin.deletedUsers")}</span><strong className={summaryValueClass}>{summary.deletedUsers}</strong></div>
          <div className={summaryCardClass}><span className={summaryLabelClass}>{t("admin.activeListings")}</span><strong className={summaryValueClass}>{summary.activeListings}</strong></div>
          <div className={summaryCardClass}><span className={summaryLabelClass}>{t("admin.completedOrders")}</span><strong className={summaryValueClass}>{summary.completedOrders}</strong></div>
          <div className={summaryCardClass}><span className={summaryLabelClass}>{t("admin.completedSales")}</span><strong className={summaryValueClass}>RM {summary.completedRevenue.toFixed(2)}</strong></div>
        </section>
      )}

      <section className="max-w-[1250px] mx-auto mb-5 rounded-[10px] bg-white p-5 shadow-[var(--shadow)]" aria-labelledby="ml-retraining-heading">
        <div className="flex items-start justify-between gap-4 max-[700px]:flex-col">
          <div>
            <h2 id="ml-retraining-heading" className="mt-0 mb-1">{t("admin.mlRetraining")}</h2>
            <p className="mt-0 text-sm text-[#666]">{t("admin.mlDescription")}</p>
          </div>
          <button
            type="button"
            className={primaryButtonClass}
            disabled={mlBusy || Boolean(mlStatus?.activeRun)}
            onClick={() => void startRetraining()}
          >
            {mlStatus?.activeRun ? t("admin.mlRetrainingNow") : t("admin.mlRetrain")}
          </button>
        </div>

        <div className="my-4 grid grid-cols-4 gap-3 max-[800px]:grid-cols-2">
          <div className="rounded-lg bg-[#f5f7fa] p-3"><span className="block text-xs text-[#666]">{t("admin.mlSyntheticRows")}</span><strong>{mlStatus?.syntheticRows ?? 1000}</strong></div>
          <div className="rounded-lg bg-[#f5f7fa] p-3"><span className="block text-xs text-[#666]">{t("admin.mlSurveyRows")}</span><strong>{mlStatus?.surveyRows ?? 0}</strong></div>
          <div className="rounded-lg bg-[#f5f7fa] p-3"><span className="block text-xs text-[#666]">{t("admin.mlCombinedRows")}</span><strong>{mlStatus?.totalRows ?? 1000}</strong></div>
          <div className="rounded-lg bg-[#f5f7fa] p-3"><span className="block text-xs text-[#666]">{t("admin.mlActiveVersion")}</span><strong className="break-all">{mlStatus?.activeModel?.version ?? "1.0.0"}</strong></div>
        </div>

        {mlStatus?.activeRun && (
          <div className="mb-4 rounded-lg border border-[#bfdbfe] bg-[#eff6ff] p-4">
            <div className="mb-2 flex justify-between gap-4 text-sm font-semibold">
              <span>{mlStatus.activeRun.stage}</span>
              <span>{mlStatus.activeRun.progress}%</span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-[#dbeafe]" role="progressbar" aria-valuenow={mlStatus.activeRun.progress} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full bg-[#2457d6] transition-[width] duration-300" style={{ width: `${mlStatus.activeRun.progress}%` }} />
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 max-[900px]:grid-cols-1">
          <div className="overflow-x-auto">
            <h3 className="mt-0 text-base">{t("admin.mlRecentRuns")}</h3>
            <table className="w-full border-collapse text-sm">
              <thead><tr><th className={cellClass}>ID</th><th className={cellClass}>{t("admin.status")}</th><th className={cellClass}>{t("admin.mlRows")}</th><th className={cellClass}>{t("admin.mlVersion")}</th></tr></thead>
              <tbody>
                {mlRuns.slice(0, 5).map(run => (
                  <tr key={run.id}>
                    <td className={cellClass}>{run.id}</td>
                    <td className={cellClass}>
                      <span className={run.status === "failed" ? "text-[#b42318]" : run.status === "succeeded" ? "text-[#1a7f37]" : "text-[#2457d6]"}>{run.status}</span>
                      {run.errorMessage && <span className="block text-xs">{run.errorMessage}</span>}
                    </td>
                    <td className={cellClass}>{run.totalRows}</td>
                    <td className={`${cellClass} max-w-[180px] break-all text-xs`}>{run.modelVersion ?? "—"}{run.artifactSha256 && <span className="block text-[#666]">{run.artifactSha256.slice(0, 12)}…</span>}</td>
                  </tr>
                ))}
                {mlRuns.length === 0 && <tr><td className={cellClass} colSpan={4}>{t("admin.mlNoRuns")}</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="overflow-x-auto">
            <h3 className="mt-0 text-base">{t("admin.mlRecentFeedback")}</h3>
            <table className="w-full border-collapse text-sm">
              <thead><tr><th className={cellClass}>ID</th><th className={cellClass}>{t("admin.mlSource")}</th><th className={cellClass}>{t("admin.mlProfile")}</th><th className={cellClass}>{t("admin.mlTargets")}</th></tr></thead>
              <tbody>
                {mlFeedback.slice(0, 5).map(item => (
                  <tr key={item.id}>
                    <td className={cellClass}>{item.id}<span className="block text-xs text-[#666]">Order {item.orderId}</span></td>
                    <td className={cellClass}>{item.source}</td>
                    <td className={`${cellClass} text-xs`}>{item.age_group} · {item.gender}<br />{item.experience_level} · {item.play_style} · {item.budget_range}</td>
                    <td className={`${cellClass} text-xs`}>{item.weightCategory} · {item.flexibilityCategory} · {item.balanceCategory}</td>
                  </tr>
                ))}
                {mlFeedback.length === 0 && <tr><td className={cellClass} colSpan={4}>{t("admin.mlNoFeedback")}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {isAdmin && showCreate && (
        <form onSubmit={createUser} className="max-w-[1250px] mx-auto mb-5 p-5 bg-white rounded-[10px] shadow-[var(--shadow)] grid grid-cols-3 gap-3 max-[800px]:grid-cols-1">
          <input className={inputClass} required placeholder={t("admin.username")} value={createForm.username} maxLength={PROFILE_LIMITS.username} onChange={(e) => setCreateForm({ ...createForm, username: e.target.value.slice(0, PROFILE_LIMITS.username) })} />
          <input className={inputClass} required type="email" placeholder={t("admin.email")} value={createForm.email} maxLength={PROFILE_LIMITS.email} onChange={(e) => setCreateForm({ ...createForm, email: e.target.value.slice(0, PROFILE_LIMITS.email) })} />
          <input className={inputClass} required minLength={8} maxLength={PROFILE_LIMITS.password} type="password" placeholder={t("admin.temporaryPassword")} value={createForm.password} onChange={(e) => setCreateForm({ ...createForm, password: e.target.value.slice(0, PROFILE_LIMITS.password) })} />
          <p className="col-span-3 max-[800px]:col-span-1 text-sm text-[#666] m-0">{t("validation.passwordRules")}</p>
          <input className={inputClass} placeholder={t("admin.firstName")} value={createForm.firstName} maxLength={PROFILE_LIMITS.name} onChange={(e) => setCreateForm({ ...createForm, firstName: e.target.value.slice(0, PROFILE_LIMITS.name) })} />
          <input className={inputClass} placeholder={t("admin.lastName")} value={createForm.lastName} maxLength={PROFILE_LIMITS.name} onChange={(e) => setCreateForm({ ...createForm, lastName: e.target.value.slice(0, PROFILE_LIMITS.name) })} />
          <select className={inputClass} value={createForm.role} onChange={(e) => setCreateForm({ ...createForm, role: e.target.value as UserRole })}>
            <option value="user">{t("admin.roleUser")}</option>
            <option value="moderator">{t("admin.roleModerator")}</option>
            <option value="admin">{t("admin.roleAdmin")}</option>
          </select>
          <button disabled={busyID === 0} className={primaryButtonClass}>{t("admin.createUser")}</button>
        </form>
      )}

      <section className="max-w-[1250px] mx-auto mb-4 flex gap-3 max-[700px]:flex-col">
        <input value={search} maxLength={PROFILE_LIMITS.search} onChange={(e) => setSearch(e.target.value.slice(0, PROFILE_LIMITS.search))} placeholder={t("admin.searchPlaceholder")} aria-label={t("admin.searchPlaceholder")} className="flex-1 px-3 py-[10px] border border-[#ccc] rounded-md" />
        <select value={role} onChange={(e) => setRole(e.target.value as "" | UserRole)} aria-label={t("admin.filterRole")} className="px-3 py-[10px] border border-[#ccc] rounded-md">
          <option value="">{t("admin.allRoles")}</option>
          <option value="user">{t("admin.roleUser")}</option>
          <option value="moderator">{t("admin.roleModerator")}</option>
          <option value="admin">{t("admin.roleAdmin")}</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as "" | AccountStatus)} aria-label={t("admin.filterStatus")} className="px-3 py-[10px] border border-[#ccc] rounded-md">
          <option value="">{t("admin.allStatuses")}</option>
          <option value="active">{t("admin.statusActive")}</option>
          <option value="suspended">{t("admin.statusSuspended")}</option>
          <option value="deleted">{t("admin.statusDeleted")}</option>
        </select>
      </section>

      <div className="max-w-[1250px] mx-auto bg-white rounded-[10px] overflow-x-auto shadow-[var(--shadow)]">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={cellClass}>ID</th>
              <th className={cellClass}>{t("admin.username")}</th>
              <th className={cellClass}>{t("admin.email")}</th>
              <th className={cellClass}>{t("admin.name")}</th>
              <th className={cellClass}>{t("admin.role")}</th>
              <th className={cellClass}>{t("admin.status")}</th>
              <th className={cellClass}>{t("admin.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const editing = editingID === user.id && editForm;
              const deleted = user.accountStatus === "deleted";
              const moderatorCanManage = viewerRole === "moderator" && user.role === "user";
              return (
                <tr key={user.id}>
                  <td className={cellClass}>{user.id}</td>
                  <td className={cellClass}>{editing ? <input className={inputClass} value={editForm.username} maxLength={PROFILE_LIMITS.username} onChange={(e) => setEditForm({ ...editForm, username: e.target.value.slice(0, PROFILE_LIMITS.username) })} /> : user.username}</td>
                  <td className={cellClass}>{editing ? <input className={inputClass} type="email" value={editForm.email} maxLength={PROFILE_LIMITS.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value.slice(0, PROFILE_LIMITS.email) })} /> : (user.email || "—")}</td>
                  <td className={cellClass}>
                    {editing
                      ? <div className="flex gap-2"><input className={inputClass} value={editForm.firstName} maxLength={PROFILE_LIMITS.name} onChange={(e) => setEditForm({ ...editForm, firstName: e.target.value.slice(0, PROFILE_LIMITS.name) })} /><input className={inputClass} value={editForm.lastName} maxLength={PROFILE_LIMITS.name} onChange={(e) => setEditForm({ ...editForm, lastName: e.target.value.slice(0, PROFILE_LIMITS.name) })} /></div>
                      : ([user.firstName, user.lastName].filter(Boolean).join(" ") || "—")}
                  </td>
                  <td className={cellClass}>
                    {isAdmin && !deleted
                      ? <select disabled={busyID === user.id} value={user.role} onChange={(e) => void changeRole(user, e.target.value as UserRole)} className={inputClass}><option value="user">{t("admin.roleUser")}</option><option value="moderator">{t("admin.roleModerator")}</option><option value="admin">{t("admin.roleAdmin")}</option></select>
                      : t(`admin.role${user.role[0].toUpperCase()}${user.role.slice(1)}`)}
                  </td>
                  <td className={cellClass}>{t(`admin.status${user.accountStatus[0].toUpperCase()}${user.accountStatus.slice(1)}`)}</td>
                  <td className={cellClass}>
                    {!deleted && (
                      <div className="flex flex-wrap gap-2 min-w-[220px]">
                        {(isAdmin || moderatorCanManage) && <button disabled={busyID === user.id} onClick={() => void changeStatus(user)} className={neutralButtonClass}>{user.accountStatus === "active" ? t("admin.suspend") : t("admin.restore")}</button>}
                        {isAdmin && (editing
                          ? <><button disabled={busyID === user.id} onClick={() => void saveEdit(user.id)} className={primaryButtonClass}>{t("admin.save")}</button><button onClick={() => { setEditingID(null); setEditForm(null); }} className={neutralButtonClass}>{t("admin.cancel")}</button></>
                          : <button onClick={() => beginEdit(user)} className={neutralButtonClass}>{t("admin.edit")}</button>)}
                        {isAdmin && <button disabled={busyID === user.id} onClick={() => void deleteUser(user)} className={dangerButtonClass}>{t("admin.delete")}</button>}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {users.length === 0 && <tr><td colSpan={7} className="px-4 py-5 text-center text-[#666]">{t("admin.noUsers")}</td></tr>}
          </tbody>
        </table>
      </div>
    </main>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type ManagedUser = {
  id: number;
  username: string;
  email: string;
  accountStatus: "active" | "suspended";
};

type AdminSummary = {
  totalUsers: number;
  activeUsers: number;
  suspendedUsers: number;
  activeListings: number;
  completedOrders: number;
  completedRevenue: number;
};

const cellClass = "px-4 py-[14px] text-left border-b border-[#eee]";
const actionButtonClass = "px-4 py-[10px] border-0 rounded-md bg-[#d32f2f] text-white cursor-pointer";
const summaryCardClass = "p-[18px] bg-white rounded-[10px] shadow-[var(--shadow)] flex flex-col gap-1.5";
const summaryLabelClass = "text-[#666] text-[.9rem]";
const summaryValueClass = "text-[1.45rem]";

export default function AdminUsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"" | "active" | "suspended">("");

  const adminFetch = useCallback(async (url: string, init?: RequestInit) => {
    const token = localStorage.getItem("adminToken");
    if (!token) {
      router.replace("/admin/login");
      throw new Error("Administrator login required");
    }
    const response = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...init?.headers },
    });
    if (response.status === 401 || response.status === 403) {
      localStorage.removeItem("adminToken");
      router.replace("/admin/login");
    }
    return response;
  }, [router]);

  const loadUsers = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (status) params.set("status", status);
      const suffix = params.size ? `?${params.toString()}` : "";
      const response = await adminFetch(`/api/v1/admin/users${suffix}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Failed to load users");
      setUsers(data.users ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    }
  }, [adminFetch, search, status]);

  const loadSummary = useCallback(async () => {
    try {
      const response = await adminFetch("/api/v1/admin/summary");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Failed to load summary");
      setSummary(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    }
  }, [adminFetch]);

  useEffect(() => { void loadUsers(); }, [loadUsers]);
  useEffect(() => { void loadSummary(); }, [loadSummary]);

  const changeStatus = async (user: ManagedUser) => {
    const accountStatus = user.accountStatus === "active" ? "suspended" : "active";
    try {
      const response = await adminFetch(`/api/v1/admin/users/${user.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ accountStatus }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Failed to update user");
      setUsers((current) => current.map((item) => item.id === user.id ? { ...item, accountStatus } : item));
      void loadSummary();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    }
  };

  const logout = () => {
    localStorage.removeItem("adminToken");
    router.push("/admin/login");
  };

  return (
    <main className="min-h-screen bg-[#f4f5f7] p-10 max-[700px]:px-3 max-[700px]:py-5">
      <div className="max-w-[1100px] mx-auto mb-6 flex items-center justify-between gap-5 max-[700px]:items-start">
        <div><h1>User management</h1><p>Suspend or restore marketplace members.</p></div>
        <button onClick={logout} className={actionButtonClass}>Log out</button>
      </div>
      {error && <p className="text-[#b42318] max-w-[1100px] mx-auto mb-4">{error}</p>}
      {summary && (
        <section className="max-w-[1100px] mx-auto mb-5 grid grid-cols-3 gap-[14px] max-[700px]:grid-cols-2" aria-label="Marketplace summary">
          <div className={summaryCardClass}><span className={summaryLabelClass}>Total users</span><strong className={summaryValueClass}>{summary.totalUsers}</strong></div>
          <div className={summaryCardClass}><span className={summaryLabelClass}>Active users</span><strong className={summaryValueClass}>{summary.activeUsers}</strong></div>
          <div className={summaryCardClass}><span className={summaryLabelClass}>Suspended users</span><strong className={summaryValueClass}>{summary.suspendedUsers}</strong></div>
          <div className={summaryCardClass}><span className={summaryLabelClass}>Active listings</span><strong className={summaryValueClass}>{summary.activeListings}</strong></div>
          <div className={summaryCardClass}><span className={summaryLabelClass}>Completed orders</span><strong className={summaryValueClass}>{summary.completedOrders}</strong></div>
          <div className={summaryCardClass}><span className={summaryLabelClass}>Completed sales</span><strong className={summaryValueClass}>RM {summary.completedRevenue.toFixed(2)}</strong></div>
        </section>
      )}
      <section className="max-w-[1100px] mx-auto mb-4 flex gap-3 max-[700px]:flex-col">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search username or email"
          aria-label="Search users"
          className="flex-1 px-3 py-[10px] border border-[#ccc] rounded-md text-base"
        />
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value as "" | "active" | "suspended")}
          aria-label="Filter users by status"
          className="px-3 py-[10px] border border-[#ccc] rounded-md text-base"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
      </section>
      <div className="max-w-[1100px] mx-auto bg-white rounded-[10px] overflow-x-auto shadow-[var(--shadow)]">
        <table className="w-full border-collapse">
          <thead><tr><th className={cellClass}>ID</th><th className={cellClass}>Username</th><th className={cellClass}>Email</th><th className={cellClass}>Status</th><th className={cellClass}>Action</th></tr></thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td className={cellClass}>{user.id}</td><td className={cellClass}>{user.username}</td><td className={cellClass}>{user.email}</td>
                <td className={cellClass}><span className={user.accountStatus === "active" ? "inline-block px-[9px] py-[5px] rounded-full font-semibold text-[#176b36] bg-[#dff5e7]" : "inline-block px-[9px] py-[5px] rounded-full font-semibold text-[#962d22] bg-[#fde2df]"}>{user.accountStatus}</span></td>
                <td className={cellClass}><button onClick={() => changeStatus(user)} className={actionButtonClass}>{user.accountStatus === "active" ? "Suspend" : "Restore"}</button></td>
              </tr>
            ))}
			{users.length === 0 && <tr><td colSpan={5} className="px-4 py-[14px] border-b border-[#eee] text-center text-[#666]">No users match this filter.</td></tr>}
          </tbody>
        </table>
      </div>
    </main>
  );
}

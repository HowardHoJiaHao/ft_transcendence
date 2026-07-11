"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "../admin.module.css";

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
    <main className={styles.dashboard}>
      <div className={styles.heading}>
        <div><h1>User management</h1><p>Suspend or restore marketplace members.</p></div>
        <button onClick={logout}>Log out</button>
      </div>
      {error && <p className={styles.error}>{error}</p>}
      {summary && (
        <section className={styles.summaryGrid} aria-label="Marketplace summary">
          <div className={styles.summaryCard}><span>Total users</span><strong>{summary.totalUsers}</strong></div>
          <div className={styles.summaryCard}><span>Active users</span><strong>{summary.activeUsers}</strong></div>
          <div className={styles.summaryCard}><span>Suspended users</span><strong>{summary.suspendedUsers}</strong></div>
          <div className={styles.summaryCard}><span>Active listings</span><strong>{summary.activeListings}</strong></div>
          <div className={styles.summaryCard}><span>Completed orders</span><strong>{summary.completedOrders}</strong></div>
          <div className={styles.summaryCard}><span>Completed sales</span><strong>RM {summary.completedRevenue.toFixed(2)}</strong></div>
        </section>
      )}
      <section className={styles.filters}>
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search username or email"
          aria-label="Search users"
        />
        <select value={status} onChange={(event) => setStatus(event.target.value as "" | "active" | "suspended")} aria-label="Filter users by status">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
      </section>
      <div className={styles.tableWrap}>
        <table>
          <thead><tr><th>ID</th><th>Username</th><th>Email</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>{user.id}</td><td>{user.username}</td><td>{user.email}</td>
                <td><span className={user.accountStatus === "active" ? styles.active : styles.suspended}>{user.accountStatus}</span></td>
                <td><button onClick={() => changeStatus(user)}>{user.accountStatus === "active" ? "Suspend" : "Restore"}</button></td>
              </tr>
            ))}
			{users.length === 0 && <tr><td colSpan={5} className={styles.empty}>No users match this filter.</td></tr>}
          </tbody>
        </table>
      </div>
    </main>
  );
}

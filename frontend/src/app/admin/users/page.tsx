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

export default function AdminUsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [error, setError] = useState("");

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
      const response = await adminFetch("/api/v1/admin/users");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Failed to load users");
      setUsers(data.users ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    }
  }, [adminFetch]);

  useEffect(() => { void loadUsers(); }, [loadUsers]);

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
          </tbody>
        </table>
      </div>
    </main>
  );
}

"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminLoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (localStorage.getItem("adminToken")) router.replace("/admin/users");
  }, [router]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/v1/admin/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Login failed");
      localStorage.setItem("adminToken", data.token);
      router.push("/admin/users");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen grid place-items-center bg-[#f4f5f7] p-6">
      <form
        className="w-full max-w-[420px] bg-white rounded-[10px] p-8 shadow-[var(--shadow)] flex flex-col gap-4"
        onSubmit={submit}
      >
        <h1>Administrator login</h1>
        {error && <p className="text-[#b42318] max-w-[1100px] mx-auto mb-4">{error}</p>}
        <input placeholder="Admin username" value={username} onChange={(e) => setUsername(e.target.value)} required className="p-3 border border-[#ccc] rounded-md text-base" />
        <input type="password" placeholder="Admin password" value={password} onChange={(e) => setPassword(e.target.value)} required className="p-3 border border-[#ccc] rounded-md text-base" />
        <button disabled={loading} className="px-4 py-[10px] border-0 rounded-md bg-[#d32f2f] text-white cursor-pointer">
          {loading ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </main>
  );
}

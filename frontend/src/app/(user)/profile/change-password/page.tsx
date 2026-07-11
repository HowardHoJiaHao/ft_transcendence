"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/components/Toast/ToastContext";
import styles from "./change-password.module.css";

export default function ChangePasswordPage() {
  const router = useRouter();
  const { logout } = useAuth();
  const { showToast } = useToast();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [tempToken, setTempToken] = useState("");
  const [loading, setLoading] = useState(false);

  const authHeaders = () => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${localStorage.getItem("token") ?? ""}`,
  });

  const requestOtp = async (event: FormEvent) => {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      showToast("New passwords do not match", "error");
      return;
    }
    setLoading(true);
    try {
      const response = await fetch("/api/v1/auth/change-password/request", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ currentPassword }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Failed to send OTP");
      setTempToken(data.tempToken);
      showToast("OTP sent to your registered email", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Network error", "error");
    } finally {
      setLoading(false);
    }
  };

  const confirmChange = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    try {
      const response = await fetch("/api/v1/auth/change-password/confirm", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ tempToken, otpCode, newPassword, confirmPassword }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Failed to change password");
      showToast(data.message ?? "Password changed", "success");
      logout();
      router.push("/login");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Network error", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className={styles.main}>
      <form className={styles.card} onSubmit={tempToken ? confirmChange : requestOtp}>
        <h1>Change password</h1>
        {!tempToken ? (
          <>
            <input type="password" placeholder="Current password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
            <input type="password" placeholder="New password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
            <input type="password" placeholder="Confirm new password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
            <button disabled={loading}>{loading ? "Sending..." : "Send OTP"}</button>
          </>
        ) : (
          <>
            <p>Enter the OTP sent to your registered email.</p>
            <input inputMode="numeric" placeholder="6-digit OTP" value={otpCode} onChange={(e) => setOtpCode(e.target.value)} required />
            <button disabled={loading}>{loading ? "Changing..." : "Change password"}</button>
          </>
        )}
        <button type="button" className={styles.secondary} onClick={() => router.push("/profile")}>Cancel</button>
      </form>
    </main>
  );
}

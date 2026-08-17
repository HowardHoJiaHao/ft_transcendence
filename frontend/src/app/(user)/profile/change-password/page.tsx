"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/components/Toast/ToastContext";
import { useI18n } from "@/context/LanguageContext";

const inputClass = "w-full p-3 pr-12 border border-[#ccc] rounded-md text-base";
const buttonClass =
  "p-3 border-0 rounded-md text-white bg-[#e53935] cursor-pointer font-semibold disabled:opacity-[0.65] disabled:cursor-not-allowed";

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 3l18 18" />
      <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
      <path d="M9.9 5.1A10.7 10.7 0 0 1 12 5c7 0 10 7 10 7a18.2 18.2 0 0 1-3.2 4.4" />
      <path d="M6.1 6.1C3.7 7.8 2 12 2 12s3 7 10 7c1.7 0 3.2-.4 4.5-1" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function PasswordField({
  placeholder,
  value,
  onChange,
  show,
  onToggle,
  showLabel,
  hideLabel,
}: {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  show: boolean;
  onToggle: () => void;
  showLabel: string;
  hideLabel: string;
}) {
  return (
    <div className="relative">
      <input
        type={show ? "text" : "password"}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required
        className={inputClass}
        autoComplete="off"
      />
      <button
        type="button"
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-[#666] bg-transparent border-0 cursor-pointer rounded-md hover:text-[#111]"
        onClick={onToggle}
        aria-label={show ? hideLabel : showLabel}
        aria-pressed={show}
      >
        <EyeIcon open={show} />
      </button>
    </div>
  );
}

export default function ChangePasswordPage() {
  const router = useRouter();
  const { logout } = useAuth();
  const { showToast } = useToast();
  const { t } = useI18n();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [tempToken, setTempToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const authHeaders = () => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${localStorage.getItem("token") ?? ""}`,
  });

  const requestOtp = async (event: FormEvent) => {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      showToast(t("changePassword.mismatch"), "error");
      return;
    }
    if (currentPassword === newPassword) {
      showToast(t("changePassword.sameAsCurrent"), "error");
      return;
    }
    setLoading(true);
    try {
      const response = await fetch("/api/v1/auth/change-password/request", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? t("changePassword.otpFailed"));
      setTempToken(data.tempToken);
      showToast(t("changePassword.otpSent"), "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("changePassword.networkError"), "error");
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
      if (!response.ok) throw new Error(data.error ?? t("changePassword.changeFailed"));
      showToast(data.message ?? t("changePassword.changed"), "success");
      logout();
      router.push("/login");
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("changePassword.networkError"), "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen grid place-items-center bg-[#fafafa] p-6">
      <form
        className="w-full max-w-[430px] p-8 bg-white rounded-[10px] shadow-[var(--shadow)] flex flex-col gap-4"
        onSubmit={tempToken ? confirmChange : requestOtp}
      >
        <h1>{t("changePassword.title")}</h1>
        {!tempToken ? (
          <>
            <PasswordField
              placeholder={t("changePassword.currentPassword")}
              value={currentPassword}
              onChange={setCurrentPassword}
              show={showCurrent}
              onToggle={() => setShowCurrent((open) => !open)}
              showLabel={t("changePassword.showPassword")}
              hideLabel={t("changePassword.hidePassword")}
            />
            <PasswordField
              placeholder={t("changePassword.newPassword")}
              value={newPassword}
              onChange={setNewPassword}
              show={showNew}
              onToggle={() => setShowNew((open) => !open)}
              showLabel={t("changePassword.showPassword")}
              hideLabel={t("changePassword.hidePassword")}
            />
            <PasswordField
              placeholder={t("changePassword.confirmPassword")}
              value={confirmPassword}
              onChange={setConfirmPassword}
              show={showConfirm}
              onToggle={() => setShowConfirm((open) => !open)}
              showLabel={t("changePassword.showPassword")}
              hideLabel={t("changePassword.hidePassword")}
            />
            <button disabled={loading} className={buttonClass}>{loading ? t("changePassword.sending") : t("changePassword.sendOtp")}</button>
          </>
        ) : (
          <>
            <p>{t("changePassword.otpPrompt")}</p>
            <input inputMode="numeric" placeholder={t("changePassword.otpPlaceholder")} value={otpCode} onChange={(e) => setOtpCode(e.target.value)} required className={inputClass} />
            <button disabled={loading} className={buttonClass}>{loading ? t("changePassword.changing") : t("changePassword.submit")}</button>
          </>
        )}
        <button
          type="button"
          className="p-3 border-0 rounded-md text-white bg-[#666] cursor-pointer font-semibold"
          onClick={() => router.push("/profile")}
        >
          {t("changePassword.cancel")}
        </button>
      </form>
    </main>
  );
}

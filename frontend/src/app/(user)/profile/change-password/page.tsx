"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/components/Toast/ToastContext";
import { useI18n } from "@/context/LanguageContext";
import PasswordField from "@/components/PasswordField/PasswordField";

const passwordInputClass = "w-full p-3 pr-12 border border-[#ccc] rounded-md text-base";
const buttonClass =
  "p-3 border-0 rounded-md text-white bg-[#e53935] cursor-pointer font-semibold disabled:opacity-[0.65] disabled:cursor-not-allowed";

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
      setTempToken(String(data.tempToken ?? "").trim());
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
        body: JSON.stringify({
          tempToken: tempToken.trim(),
          otpCode: otpCode.trim(),
          newPassword,
          confirmPassword,
        }),
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
              className={passwordInputClass}
            />
            <PasswordField
              placeholder={t("changePassword.newPassword")}
              value={newPassword}
              onChange={setNewPassword}
              show={showNew}
              onToggle={() => setShowNew((open) => !open)}
              showLabel={t("changePassword.showPassword")}
              hideLabel={t("changePassword.hidePassword")}
              className={passwordInputClass}
            />
            <PasswordField
              placeholder={t("changePassword.confirmPassword")}
              value={confirmPassword}
              onChange={setConfirmPassword}
              show={showConfirm}
              onToggle={() => setShowConfirm((open) => !open)}
              showLabel={t("changePassword.showPassword")}
              hideLabel={t("changePassword.hidePassword")}
              className={passwordInputClass}
            />
            <button disabled={loading} className={buttonClass}>{loading ? t("changePassword.sending") : t("changePassword.sendOtp")}</button>
          </>
        ) : (
          <>
            <p>{t("changePassword.otpPrompt")}</p>
            <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder={t("changePassword.otpPlaceholder")} value={otpCode} onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))} required className="w-full p-3 border border-[#ccc] rounded-md text-base" />
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

"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { useToast } from "@/components/Toast/ToastContext";
import Header from "@/components/Header/Header";
import { resolveAvatarUrl, PLACEHOLDER_AVATAR } from "@/lib/avatar";
import { useI18n } from "@/context/LanguageContext";

interface UserProfile {
  id: number;
  username: string;
  email: string;
  firstName?: string;
  lastName?: string;
  phoneNo?: string;
  gender?: string;
  dateOfBirth?: string;
  avatarUrl?: string;
  oauthProvider?: string;
}

// Shared with My Shop / Developer API / Bulk Import so the whole seller area
// reads as one design: grey page, white bordered cards, blue-bar section
// headings, pill primary buttons and outlined secondary ones.
const PAGE = 'min-h-screen bg-[#f0f0f0]';
const CONTAINER =
  'max-w-[980px] mx-auto pt-7 px-8 pb-16 max-[640px]:pt-5 max-[640px]:px-4 max-[640px]:pb-12';
const CARD =
  'bg-white border border-[#e8e8e6] rounded-xl px-5 py-[18px] mb-6 shadow-[0_1px_3px_rgba(0,0,0,0.05)]';
const SECTION_H2 =
  "flex items-center gap-2 text-base font-bold text-[#222] mt-0 mx-0 mb-4 before:content-[''] before:w-1 before:h-[18px] before:bg-[#2a78d6] before:rounded-sm before:shrink-0";
const ROW =
  'flex gap-4 items-center py-3 border-b border-[#f2f2f0] last:border-b-0 max-[640px]:flex-col max-[640px]:items-start max-[640px]:gap-2';
const LABEL = 'w-[150px] shrink-0 text-[13.5px] font-semibold text-[#444]';
const VALUE = 'flex-1 min-w-0 text-sm text-[#222] break-words';
const MUTED = 'flex-1 min-w-0 text-sm text-[#898781] break-words';
const INPUT =
  'flex-1 min-w-0 border border-[#ddd] rounded-lg px-3 py-2 text-sm text-[#222] bg-white transition-colors duration-150 focus:border-[#2a78d6] focus:outline-none max-[640px]:w-full';
const BTN_SECONDARY =
  'shrink-0 border border-[#ccc] bg-white rounded-lg px-3.5 py-[7px] text-[13px] font-semibold text-[#333] cursor-pointer transition-[border-color] duration-150 hover:border-[#888]';
const BTN_DISABLED =
  'shrink-0 border border-[#ddd] bg-[#f3f3f3] rounded-lg px-3.5 py-[7px] text-[13px] font-semibold text-[#999] cursor-not-allowed';
const BTN_PRIMARY =
  'inline-flex items-center px-[22px] py-[9px] rounded-[20px] bg-[#111] text-white border-none text-sm font-semibold cursor-pointer transition-colors duration-150 hover:bg-[#333] disabled:bg-[#bbb] disabled:cursor-not-allowed';

// <input type="date"> only accepts YYYY-MM-DD, but the API sends a full ISO
// timestamp — trim it so the field shows the stored birthday.
const toDateInput = (value?: string) => (value ? value.slice(0, 10) : '');

export default function ProfilePage() {
  const router = useRouter();
  const { user: ctxUser, loading: authLoading, updateUser } = useRequireAuth('/');
  const { showToast } = useToast();
  const { t } = useI18n();
  const [user, setUser] = useState<UserProfile | null>(ctxUser ?? null);
  const [loading, setLoading] = useState(!ctxUser);
  const [error, setError] = useState<string | null>(null);
  const [inputData, setInputData] = useState({
    firstName: ctxUser?.firstName ?? "",
    lastName: ctxUser?.lastName ?? "",
    gender: ctxUser?.gender ?? "",
    dateOfBirth: toDateInput(ctxUser?.dateOfBirth),
  });

  useEffect(() => 
    {setUser(ctxUser ?? null);
  }, [ctxUser]);

  //OTP Handling
  const [showOtp, setShowOtp] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [tempToken, setTempToken] = useState("");
  const [resendCd, setResendCd] = useState(0);

  useEffect(() => {
    if (resendCd <= 0) return;

    const timer = setInterval(() => {
      setResendCd((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);

    return () => clearInterval(timer);
  }, [resendCd]);

  const sendOtp = async () => {
    if (resendCd > 0) return false;

    if (!ctxUser?.email.trim()) {
      showToast("Email is required to resend OTP", "error");
      return false;
    }

    try {
      const res = await fetch("/api/v1/auth/resend-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: ctxUser?.email }),
      });

      const data = await res.json();
      if (res.ok) {
        if (!data.tempToken) {
          showToast(
            "Resend succeeded but no tempToken returned. Please try login again.",
            "error",
          );
          return false;
        }
        setTempToken(data.tempToken);
        setResendCd(60);
        showToast(data.message ?? "OTP resent", "success");
        return true;
      }
      showToast(data.error ?? "Failed to resend OTP", "error");
      return false;
    } catch (err) {
      console.error(err);
      showToast("Network error", "error");
      return false;
    }
  };

  const startOtpFlow = async () => {
    setOtpCode("");
    const sent = await sendOtp();
    if (sent) setShowOtp(true);
  };

  //OTP Handling
  const handleOtp = async () => {
    try {
      if (!tempToken.trim() || !otpCode.trim()) {
        showToast(
          "tempToken and otpCode are required. Please request a new OTP and enter the code.",
          "error",
        );
        return;
      }
      const res = await fetch("/api/v1/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tempToken, otpCode }),
      });
      const data = await res.json();
      if (res.ok) //means status code between 200 and 299
      {
        if (
          data?.needOtp
        ) //the backend will only return needotp if it is after sending email step
        {
          setTempToken(data.tempToken);
          setShowOtp(true);
        } else //step after verified the otp
        {
          setShowOtp(false);
          setOtpCode("");
          showToast("OTP verified", "success");
          router.push("/profile/change-email");
        }
      } else {
        setOtpCode("");
        showToast(data.error, "error");
      }
    } catch (err) {
      console.error(err); //prints error in browser dev console
      showToast("Network error", "error");
    }
  };

  const handleOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await handleOtp();
  };

  const isGoogleAuthenticated = user?.oauthProvider === "google";

  useEffect(() => {
    const fetchMe = async () => {
      setLoading(true);
      try {
        const token = localStorage.getItem("token") ?? "";
        const res = await fetch("/api/v1/me", {
          headers: {
            Authorization: token ? `Bearer ${token}` : "",
          },
        });

        if (res.status === 401) //unauthorized/expired/invalid
        {
          router.push("/login");
          return;
        }

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Failed to load profile");
        }

        const data = await res.json();
        if (data.token) localStorage.setItem("token", data.token);
        setUser(data.user);
      } catch (err) {
        if (err instanceof Error) setError(err.message);
        else setError("An unexpected error occured");
      } finally {
        setLoading(false);
      }
    };

    fetchMe();
  }, [router]);

  useEffect(() => {
    if (user) {
      setInputData({
        firstName: user.firstName ?? "",
        lastName: user.lastName ?? "",
        gender: user.gender ?? "",
        dateOfBirth: toDateInput(user.dateOfBirth),
      });
    }
  }, [user]);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    const { name, value } = e.target;
    setInputData((prev) => ({ ...prev, [name]: value }));
  };

  //							AVATAR HANDLING
  const fileInputRef = useRef<HTMLInputElement>(null);

  const triggerFileSelect = () => {
    fileInputRef.current?.click();
  };

  const handleChangeAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!user) {
      showToast("User not loaded", "error");
      return;
    }
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      showToast("File is too large (max 2MB)", "error");
      return;
    }

    const uploadPayload = new FormData();
    uploadPayload.append("avatar", file);

    try {
      const token = localStorage.getItem("token");
      const res = await fetch(
        `/api/v1/users/upload-avatar`,
        {
          method: "POST",
          headers: { Authorization: token ? `Bearer ${token}` : "" },
          body: uploadPayload,
        },
      );
      if (res.ok) {
        const data = await res.json();
        // Add cache busting timestamp to force browser to reload the new image
        const cacheBuster = `?t=${Date.now()}`;
        const newAvatarUrl = data.avatarUrl + cacheBuster;
        setUser((prev) => (prev ? { ...prev, avatarUrl: newAvatarUrl } : null));
        // Update auth context so avatar reflects everywhere in the app
        updateUser({ avatarUrl: newAvatarUrl });
        showToast("Avatar updated succesfully", "success");
      } else {
        showToast("Failed to upload avatar", "error");
      }
    } catch (err) {
      console.error(err);
      showToast("Error uploading file", "error");
    }
  };

  const handleSave = async () => {
    try {
      const updatedInputData = {
        ...inputData,
        dateOfBirth: inputData.dateOfBirth
          ? new Date(`${inputData.dateOfBirth}T00:00:00Z`).toISOString()
          : null,
      };
      const token = localStorage.getItem("token");
      const res = await fetch("/api/v1/users/update", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(updatedInputData),
      });
      if (res.ok) {
        showToast("Profile successfully updated", "success");
        const updated = await res.json();
        setUser(updated);
      } else {
        showToast("Failed to update profile", "error");
      }
    } catch (err) {
      showToast("Connection error. is the server running?", "error");
    }
  };
  if (authLoading || loading)
    return (
      <main className={PAGE}>
        <Header />
        <div className={CONTAINER}>
          <p className="text-[#898781] text-[15px]">Loading profile…</p>
        </div>
      </main>
    );

  if (error)
    return (
      <main className={PAGE}>
        <Header />
        <div className={CONTAINER}>
          <h1 className="text-[26px] font-bold text-[#222] mt-0 mx-0 mb-4">👤 My Profile</h1>
          <div className={CARD}>
            <p className="bg-[#fdecea] border border-[#f5c6c0] rounded-md text-[#b71c1c] text-sm px-3.5 py-2.5 mt-0 mx-0 mb-4">
              {error}
            </p>
            <button className={BTN_PRIMARY} onClick={() => router.push("/login")}>
              Go to login
            </button>
          </div>
        </div>
      </main>
    );

  if (!user) return null;

  const today = new Date().toISOString().split("T")[0];


  if (showOtp) {
    return (
      <main className={PAGE}>
        <Header />

        <div className="max-w-[480px] mx-auto pt-10 px-4 pb-16">
          <button
            className="bg-white border border-[#ddd] rounded-[20px] text-[#444] text-[13px] font-semibold cursor-pointer px-4 py-[7px] mb-3.5 inline-flex items-center gap-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition-all duration-150 hover:border-[#888] hover:text-[#111] hover:-translate-x-0.5"
            onClick={() => setShowOtp(false)}
            type="button"
          >
            ← Back
          </button>

          <h1 className="text-[26px] font-bold text-[#222] mt-0 mx-0 mb-4">🔐 Verify it&apos;s you</h1>
          <p className="text-[#898781] text-sm mt-[-8px] mx-0 mb-[18px]">
            We sent a 6-digit code to {user.email}.
          </p>

          <form onSubmit={handleOtpSubmit} className={CARD}>
            <div className="bg-[#eff6ff] border border-[#bfdbfe] rounded-[10px] px-4 py-3 mb-4">
              <p className="text-[13px] text-[#1c5cab] m-0">
                Verifying in order to change your{" "}
                <strong>email address</strong>.
              </p>
            </div>

            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="6-digit code"
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value)}
              required
              className="w-full border border-[#ddd] rounded-lg px-3.5 py-2.5 text-lg tracking-[0.35em] text-center text-[#222] bg-white transition-colors duration-150 focus:border-[#2a78d6] focus:outline-none"
            />

            <div className="flex gap-2.5 items-center mt-4 flex-wrap">
              <button type="submit" className={BTN_PRIMARY}>
                Verify code
              </button>
              <button
                type="button"
                className={`${BTN_SECONDARY} disabled:text-[#aaa] disabled:cursor-not-allowed disabled:hover:border-[#ccc]`}
                onClick={sendOtp}
                disabled={resendCd > 0}
              >
                {resendCd > 0 ? `Resend in ${resendCd}s` : "Resend code"}
              </button>
            </div>
          </form>
        </div>
      </main>
    );
  }
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ");

  return (
    <main className={PAGE}>
      <Header />

      <div className={CONTAINER}>
        <h1 className="text-[26px] font-bold text-[#222] mt-0 mx-0 mb-4">👤 My Profile</h1>
        <p className="text-[#898781] text-sm mt-[-8px] mx-0 mb-[18px]">
          Manage and protect your account
        </p>

        {/* ── Identity: avatar + who you are at a glance ── */}
        <div className={CARD}>
          <div className="flex gap-5 items-center max-[640px]:flex-col max-[640px]:text-center">
            <img
              src={resolveAvatarUrl(user.avatarUrl)}
              alt="Profile avatar"
              className="w-[88px] h-[88px] shrink-0 rounded-full object-cover border border-[#e8e8e6] bg-[#f5f5f3] shadow-[0_1px_3px_rgba(0,0,0,0.08)]"
              onError={(event) => {
                (event.currentTarget as HTMLImageElement).src = PLACEHOLDER_AVATAR;
              }}
            />

            <div className="min-w-0 flex-1">
              <p className="text-[19px] font-bold text-[#222] m-0 truncate">
                {fullName || user.username}
              </p>
              <p className="text-[#898781] text-sm mt-1 mx-0 mb-0 truncate">{user.email}</p>

              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept="image/*"
                onChange={handleChangeAvatar}
              />
              <button type="button" className={`${BTN_SECONDARY} mt-3`} onClick={triggerFileSelect}>
                📷 Change avatar
              </button>
              <span className="block text-xs text-[#898781] mt-2">JPG or PNG, up to 2 MB.</span>
            </div>
          </div>
        </div>

        {/* ── Account & security: read-only values with their own change flows ── */}
        <div className={CARD}>
          <h2 className={SECTION_H2}>🔐 Account &amp; security</h2>

          <div className={ROW}>
            <div className={LABEL}>Username</div>
            <div className={VALUE}>{user.username}</div>
          </div>

          <div className={ROW}>
            <div className={LABEL}>Email</div>
            <div className={VALUE}>{user.email}</div>
            <button
              className={isGoogleAuthenticated ? BTN_DISABLED : BTN_SECONDARY}
              disabled={isGoogleAuthenticated}
              title={isGoogleAuthenticated ? t("profile.googleManaged") : undefined}
              onClick={isGoogleAuthenticated ? undefined : startOtpFlow}
            >
              Change
            </button>
          </div>

          <div className={ROW}>
            <div className={LABEL}>Phone number</div>
            <div className={user.phoneNo ? VALUE : MUTED}>{user.phoneNo || "Not set"}</div>
            <button
              className={BTN_SECONDARY}
              onClick={() => router.push("/profile/change-phoneNo")}
            >
              Change
            </button>
          </div>

          <div className={ROW}>
            <div className={LABEL}>Password</div>
            <div className={`${VALUE} tracking-[0.2em]`}>••••••••</div>
            <button
              className={isGoogleAuthenticated ? BTN_DISABLED : BTN_SECONDARY}
              disabled={isGoogleAuthenticated}
              title={isGoogleAuthenticated ? t("profile.googleManaged") : undefined}
              onClick={isGoogleAuthenticated ? undefined : () => router.push("/profile/change-password")}
            >
              Change
            </button>
          </div>

          <p className="text-xs text-[#898781] mt-3.5 mb-0">
            {isGoogleAuthenticated ? t("profile.googleSecurityHint") : t("profile.emailOtpHint")}
          </p>
        </div>

        {/* ── Personal details: the only editable-in-place fields ── */}
        <div className={CARD}>
          <h2 className={SECTION_H2}>📝 Personal details</h2>

          <div className={ROW}>
            <label className={LABEL} htmlFor="firstName">
              First name
            </label>
            <input
              id="firstName"
              name="firstName"
              value={inputData.firstName}
              onChange={handleChange}
              placeholder="Your first name"
              className={INPUT}
            />
          </div>

          <div className={ROW}>
            <label className={LABEL} htmlFor="lastName">
              Last name
            </label>
            <input
              id="lastName"
              name="lastName"
              value={inputData.lastName}
              onChange={handleChange}
              placeholder="Your last name"
              className={INPUT}
            />
          </div>

          <div className={ROW}>
            <div className={LABEL}>Gender</div>
            <div className="flex-1 min-w-0 flex gap-2 items-center flex-wrap">
              <label
                className={`inline-flex items-center gap-2 px-3.5 py-[7px] rounded-[20px] border text-[13px] cursor-pointer transition-all duration-150 ${inputData.gender === "Male" ? "bg-[#fce4ec] border-[#f48fb1] text-[#c2185b] font-bold" : "bg-white border-[#ccc] text-[#444] font-medium hover:border-[#888]"}`}
              >
                <input
                  type="radio"
                  name="gender"
                  value="Male"
                  checked={inputData.gender === "Male"}
                  onChange={handleChange}
                  className="accent-[#c2185b]"
                />
                Male
              </label>
              <label
                className={`inline-flex items-center gap-2 px-3.5 py-[7px] rounded-[20px] border text-[13px] cursor-pointer transition-all duration-150 ${inputData.gender === "Female" ? "bg-[#fce4ec] border-[#f48fb1] text-[#c2185b] font-bold" : "bg-white border-[#ccc] text-[#444] font-medium hover:border-[#888]"}`}
              >
                <input
                  type="radio"
                  name="gender"
                  value="Female"
                  checked={inputData.gender === "Female"}
                  onChange={handleChange}
                  className="accent-[#c2185b]"
                />
                Female
              </label>
              <label className="inline-flex items-center gap-2 px-3.5 py-[7px] rounded-[20px] border border-[#ccc] bg-white text-[13px] font-medium text-[#444] cursor-pointer transition-all duration-150 hover:border-[#888]">
                <input
                  type="radio"
                  name="gender"
                  value="PreferNotToTell"
                  checked={false}
                  onChange={() => {
                    showToast("Please choose your gender! 🏳️‍🌈", "success");
                  }}
                  className="accent-[#c2185b]"
                />
                Prefer not to tell
              </label>
              {inputData.gender && (
                <button
                  type="button"
                  className="text-[13px] font-semibold text-[#2563eb] bg-transparent border-none cursor-pointer px-1.5 py-1 hover:underline"
                  onClick={() => setInputData((prev) => ({ ...prev, gender: "" }))}
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          <div className={ROW}>
            <label className={LABEL} htmlFor="dateOfBirth">
              Date of birth
            </label>
            <div className="flex-1 min-w-0 flex gap-3 items-center flex-wrap">
              <input
                id="dateOfBirth"
                type="date"
                name="dateOfBirth"
                value={inputData.dateOfBirth}
                onChange={handleChange}
                max={today}
                min="1950-01-01"
                className="border border-[#ddd] rounded-lg px-3 py-2 text-sm text-[#222] bg-white transition-colors duration-150 focus:border-[#2a78d6] focus:outline-none"
              />
              {user.dateOfBirth && (
                <span className="text-[13px] text-[#898781]">
                  currently {new Date(user.dateOfBirth).toLocaleDateString()}
                </span>
              )}
            </div>
          </div>

          <div className="mt-5 pt-4 border-t border-[#eee] flex items-center gap-3 flex-wrap">
            <button className={BTN_PRIMARY} onClick={handleSave}>
              Save changes
            </button>
            <span className="text-xs text-[#898781]">
              Only the fields in this section are saved by this button.
            </span>
          </div>
        </div>
      </div>
    </main>
  );
}

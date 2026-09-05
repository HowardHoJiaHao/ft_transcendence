"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { useToast } from "@/components/Toast/ToastContext";
import Header from "@/components/Header/Header";
import { resolveAvatarUrl, PLACEHOLDER_AVATAR, avatarClass } from "@/lib/avatar";
import { useI18n } from "@/context/LanguageContext";
import { PROFILE_LIMITS, validateProfileFields } from "@/lib/profileValidation";
import { MALAYSIA_STATES, districtsOf } from "@/lib/malaysia";

interface UserProfile {
  id: number;
  username: string;
  email: string;
  firstName?: string;
  lastName?: string;
  phoneNo?: string;
  // Delivery address, one per account. The seller sees it on a pending order
  // so they know where to send the item, which is why it is edited here rather
  // than being asked for at checkout.
  address?: string;
  postcode?: string;
  state?: string;
  district?: string;
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
    address: "",
    postcode: "",
    state: "",
    district: "",
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
      showToast(t("profile.emailRequiredForOtp"), "error");
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
          showToast(t("profile.resendNoToken"), "error");
          return false;
        }
        setTempToken(data.tempToken);
        setResendCd(60);
        showToast(data.message ?? t("profile.otpResent"), "success");
        return true;
      }
      showToast(data.error ?? t("profile.resendFailed"), "error");
      return false;
    } catch (err) {
      console.error(err);
      showToast(t("profile.networkError"), "error");
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
        showToast(t("profile.otpFieldsRequired"), "error");
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
          showToast(t("profile.otpVerified"), "success");
          router.push("/profile/change-email");
        }
      } else {
        setOtpCode("");
        showToast(data.error, "error");
      }
    } catch (err) {
      console.error(err); //prints error in browser dev console
      showToast(t("profile.networkError"), "error");
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
          throw new Error(data.error || t("profile.loadFailed"));
        }

        const data = await res.json();
        if (data.token) localStorage.setItem("token", data.token);
        setUser(data.user);
      } catch (err) {
        if (err instanceof Error) setError(err.message);
        else setError(t("profile.unexpectedError"));
      } finally {
        setLoading(false);
      }
    };

    fetchMe();
  }, [router, t]);

  useEffect(() => {
    if (user) {
      setInputData({
        firstName: user.firstName ?? "",
        lastName: user.lastName ?? "",
        address: user.address ?? "",
        postcode: user.postcode ?? "",
        state: user.state ?? "",
        district: user.district ?? "",
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
      showToast(t("profile.userNotLoaded"), "error");
      return;
    }
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      showToast(t("profile.fileTooLarge"), "error");
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
        showToast(t("profile.avatarUpdated"), "success");
      } else {
        showToast(t("profile.avatarUploadFailed"), "error");
      }
    } catch (err) {
      console.error(err);
      showToast(t("profile.avatarUploadError"), "error");
    }
  };

  const handleSave = async () => {
    const problems = validateProfileFields({
      firstName: inputData.firstName,
      lastName: inputData.lastName,
      address: inputData.address,
      postcode: inputData.postcode,
      state: inputData.state,
      district: inputData.district,
      dateOfBirth: inputData.dateOfBirth,
    });
    if (problems.length > 0) {
      showToast(t(problems[0].key), "error");
      return;
    }

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
        showToast(t("profile.profileUpdated"), "success");
        const updated = await res.json();
        setUser(updated);
        // Without this the rest of the app keeps reading the copy cached at login.
        updateUser({
          email: updated.email ?? "",
          firstName: updated.firstName ?? "",
          lastName: updated.lastName ?? "",
          phoneNo: updated.phoneNo ?? "",
          address: updated.address ?? "",
          postcode: updated.postcode ?? "",
          state: updated.state ?? "",
          district: updated.district ?? "",
          gender: updated.gender ?? "",
        });
      } else {
        const data = await res.json().catch(() => ({}));
        showToast(data.error ?? t("profile.profileUpdateFailed"), "error");
      }
    } catch (err) {
      showToast(t("profile.connectionError"), "error");
    }
  };
  if (authLoading || loading)
    return (
      <main className={PAGE}>
        <Header />
        <div className={CONTAINER}>
          <p className="text-[#898781] text-[15px]">{t("profile.loading")}</p>
        </div>
      </main>
    );

  if (error)
    return (
      <main className={PAGE}>
        <Header />
        <div className={CONTAINER}>
          <h1 className="text-[26px] font-bold text-[#222] mt-0 mx-0 mb-4">{t("profile.heading")}</h1>
          <div className={CARD}>
            <p className="bg-[#fdecea] border border-[#f5c6c0] rounded-md text-[#b71c1c] text-sm px-3.5 py-2.5 mt-0 mx-0 mb-4">
              {error}
            </p>
            <button className={BTN_PRIMARY} onClick={() => router.push("/login")}>
              {t("profile.goToLogin")}
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
            {t("profile.back")}
          </button>

          <h1 className="text-[26px] font-bold text-[#222] mt-0 mx-0 mb-4">{t("profile.verifyTitle")}</h1>
          <p className="text-[#898781] text-sm mt-[-8px] mx-0 mb-[18px]">
            {t("profile.verifySubtitle", { email: user.email })}
          </p>

          <form onSubmit={handleOtpSubmit} className={CARD}>
            <div className="bg-[#eff6ff] border border-[#bfdbfe] rounded-[10px] px-4 py-3 mb-4">
              <p className="text-[13px] text-[#1c5cab] m-0">
                {t("profile.verifyReasonPrefix")}{" "}
                <strong>{t("profile.verifyReasonTarget")}</strong>.
              </p>
            </div>

            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder={t("profile.otpPlaceholder")}
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, PROFILE_LIMITS.otp))}
              maxLength={PROFILE_LIMITS.otp}
              required
              className="w-full border border-[#ddd] rounded-lg px-3.5 py-2.5 text-lg tracking-[0.35em] text-center text-[#222] bg-white transition-colors duration-150 focus:border-[#2a78d6] focus:outline-none"
            />

            <div className="flex gap-2.5 items-center mt-4 flex-wrap">
              <button type="submit" className={BTN_PRIMARY}>
                {t("profile.verifyCode")}
              </button>
              <button
                type="button"
                className={`${BTN_SECONDARY} disabled:text-[#aaa] disabled:cursor-not-allowed disabled:hover:border-[#ccc]`}
                onClick={sendOtp}
                disabled={resendCd > 0}
              >
                {resendCd > 0
                  ? t("profile.resendIn", { seconds: resendCd })
                  : t("profile.resendCode")}
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
        <h1 className="text-[26px] font-bold text-[#222] mt-0 mx-0 mb-4">{t("profile.heading")}</h1>
        <p className="text-[#898781] text-sm mt-[-8px] mx-0 mb-[18px]">
          {t("profile.subheading")}
        </p>

        {/* ── Identity: avatar + who you are at a glance ── */}
        <div className={CARD}>
          <div className="flex gap-5 items-center max-[640px]:flex-col max-[640px]:text-center">
            <img
              src={resolveAvatarUrl(user.avatarUrl)}
              alt={t("profile.avatarAlt")}
              className={avatarClass('profile', 'border border-[#e8e8e6] shadow-[0_1px_3px_rgba(0,0,0,0.08)]')}
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
                {t("profile.changeAvatar")}
              </button>
              <span className="block text-xs text-[#898781] mt-2">{t("profile.avatarHint")}</span>
            </div>
          </div>
        </div>

        {/* ── Account & security: read-only values with their own change flows ── */}
        <div className={CARD}>
          <h2 className={SECTION_H2}>{t("profile.accountSecurity")}</h2>

          <div className={ROW}>
            <div className={LABEL}>{t("profile.username")}</div>
            <div className={VALUE}>{user.username}</div>
          </div>

          <div className={ROW}>
            <div className={LABEL}>{t("profile.email")}</div>
            <div className={VALUE}>{user.email}</div>
            <button
              className={isGoogleAuthenticated ? BTN_DISABLED : BTN_SECONDARY}
              disabled={isGoogleAuthenticated}
              title={isGoogleAuthenticated ? t("profile.googleManaged") : undefined}
              onClick={isGoogleAuthenticated ? undefined : startOtpFlow}
            >
              {t("profile.change")}
            </button>
          </div>

          <div className={ROW}>
            <div className={LABEL}>{t("profile.phoneNo")}</div>
            <div className={user.phoneNo ? VALUE : MUTED}>{user.phoneNo || t("profile.notSet")}</div>
            <button
              className={BTN_SECONDARY}
              onClick={() => router.push("/profile/change-phoneNo")}
            >
              {t("profile.change")}
            </button>
          </div>

          <div className={ROW}>
            <div className={LABEL}>{t("profile.password")}</div>
            <div className={`${VALUE} tracking-[0.2em]`}>••••••••</div>
            <button
              className={isGoogleAuthenticated ? BTN_DISABLED : BTN_SECONDARY}
              disabled={isGoogleAuthenticated}
              title={isGoogleAuthenticated ? t("profile.googleManaged") : undefined}
              onClick={isGoogleAuthenticated ? undefined : () => router.push("/profile/change-password")}
            >
              {t("profile.change")}
            </button>
          </div>

          <p className="text-xs text-[#898781] mt-3.5 mb-0">
            {isGoogleAuthenticated ? t("profile.googleSecurityHint") : t("profile.emailOtpHint")}
          </p>
        </div>

        {/* ── Personal details: the only editable-in-place fields ── */}
        <div className={CARD}>
          <h2 className={SECTION_H2}>{t("profile.personalDetails")}</h2>

          <div className={ROW}>
            <label className={LABEL} htmlFor="firstName">
              {t("profile.firstName")}
            </label>
            <input
              id="firstName"
              name="firstName"
              maxLength={PROFILE_LIMITS.name}
              value={inputData.firstName}
              onChange={handleChange}
              placeholder={t("profile.firstNamePlaceholder")}
              className={INPUT}
            />
          </div>

          <div className={ROW}>
            <label className={LABEL} htmlFor="lastName">
              {t("profile.lastName")}
            </label>
            <input
              id="lastName"
              name="lastName"
              maxLength={PROFILE_LIMITS.name}
              value={inputData.lastName}
              onChange={handleChange}
              placeholder={t("profile.lastNamePlaceholder")}
              className={INPUT}
            />
          </div>

          {/* One address per account — the seller of an order you place sees
              it, so they know where to send the item. Saved by the button at
              the bottom of this section along with the fields around it. */}
          <div className={ROW}>
            <label className={LABEL} htmlFor="address">
              {t("profile.address")}
            </label>
            <div className="flex-1 min-w-0">
              <input
                id="address"
                name="address"
                value={inputData.address}
                onChange={handleChange}
                placeholder={t("profile.addressPlaceholder")}
                maxLength={PROFILE_LIMITS.address}
                className={`${INPUT} w-full`}
              />
              <div className="grid grid-cols-3 gap-2 mt-2 max-[640px]:grid-cols-1">
                <input
                  id="postcode"
                  name="postcode"
                  value={inputData.postcode}
                  onChange={handleChange}
                  placeholder={t("profile.postcodePlaceholder")}
                  maxLength={PROFILE_LIMITS.postcode}
                  inputMode="numeric"
                  className={`${INPUT} w-full`}
                />
                <select
                  id="state"
                  name="state"
                  value={inputData.state}
                  onChange={(e) =>
                    setInputData((prev) => ({
                      ...prev,
                      state: e.target.value,
                      district: "",
                    }))
                  }
                  className={`${INPUT} w-full`}
                >
                  <option value="">{t("profile.stateSelect")}</option>
                  {MALAYSIA_STATES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <select
                  id="district"
                  name="district"
                  value={inputData.district}
                  onChange={handleChange}
                  disabled={!inputData.state}
                  className={`${INPUT} w-full disabled:bg-[#f5f5f4] disabled:text-[#a3a3a3] disabled:cursor-not-allowed`}
                >
                  <option value="">{t("profile.districtSelect")}</option>
                  {districtsOf(inputData.state).map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
              <span className="block text-xs text-[#898781] mt-1.5">
                {t("profile.addressHint")}
              </span>
            </div>
          </div>

          <div className={ROW}>
            <div className={LABEL}>{t("profile.gender")}</div>
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
                {t("profile.male")}
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
                {t("profile.female")}
              </label>
            </div>
          </div>

          <div className={ROW}>
            <label className={LABEL} htmlFor="dateOfBirth">
              {t("profile.dateOfBirth")}
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
                  {t("profile.currently", {
                    date: new Date(user.dateOfBirth).toLocaleDateString(),
                  })}
                </span>
              )}
            </div>
          </div>

          <div className="mt-5 pt-4 border-t border-[#eee] flex items-center gap-3 flex-wrap">
            <button className={BTN_PRIMARY} onClick={handleSave}>
              {t("profile.saveChanges")}
            </button>
            <span className="text-xs text-[#898781]">
              {t("profile.saveHint")}
            </span>
          </div>
        </div>

      </div>
    </main>
  );
}

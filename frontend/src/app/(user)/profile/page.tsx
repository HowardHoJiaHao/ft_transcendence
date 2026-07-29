"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { useToast } from "@/components/Toast/ToastContext";
import Header from "@/components/Header/Header";

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
}

export default function ProfilePage() {
  const router = useRouter();
  const { user: ctxUser, loading: authLoading, updateUser } = useRequireAuth('/');
  const { showToast } = useToast();
  const [user, setUser] = useState<UserProfile | null>(ctxUser ?? null);
  const [loading, setLoading] = useState(!ctxUser);
  const [error, setError] = useState<string | null>(null);
  const [inputData, setInputData] = useState({
    firstName: ctxUser?.firstName ?? "",
    lastName: ctxUser?.lastName ?? "",
    gender: ctxUser?.gender ?? "",
    dateOfBirth: ctxUser?.dateOfBirth ?? "",
  });

  useEffect(() => 
    {setUser(ctxUser ?? null);
  }, [ctxUser]);

  //OTP Handling
  const [showOtp, setShowOtp] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [tempToken, setTempToken] = useState("");
  const [resendCd, setResendCd] = useState(0);
  const [changeTarget, setChangeTarget] = useState<"email" | "phoneNo" | null>(
    null,
  );

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

  const startOtpFlow = async (target: "email" | "phoneNo") => {
    setChangeTarget(target);
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
          router.push(
            changeTarget === "email"
              ? "/profile/change-email"
              : "/profile/change-phoneNo",
          );
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
        dateOfBirth: user.dateOfBirth ?? "",
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
  if (authLoading || loading) return <div style={{ padding: 24 }}>Loading profile...</div>;
  if (error)
    return (
      <div style={{ padding: 24 }}>
        <p>Error: {error}</p>
        <button
          className="btn btn-secondary"
          onClick={() => router.push("/login")}
        >
          Login
        </button>
      </div>
    );

  if (!user) return null;

  const today = new Date().toISOString().split("T")[0];

  // backend base URL for serving avatars
  const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';
  const defaultAvatarUrl = "/default-avatar.png";
  const placeholderAvatarUrl = "https://via.placeholder.com/120";
  const resolveAvatarUrl = (url?: string) => {
    if (!url)
      return defaultAvatarUrl;
    if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("data:"))
      return url;
    if (url.startsWith("/"))
      return `${API_BASE}${url}`;
    return `${API_BASE}/${url}`;
  };

  if (showOtp) {
    return (
      <div className="flex justify-center items-center min-h-[calc(100vh-80px)] px-4 py-6 bg-[#fafafa]">
        <form onSubmit={handleOtpSubmit} className="bg-white p-10 rounded-lg shadow-[0_4px_6px_rgba(0,0,0,0.1)] w-full max-w-[400px] flex flex-col gap-4">
          <h2 className="text-center mb-2 text-[#333]">Enter OTP Code</h2>
          <p className="text-center m-0 text-[#666]">
            Verifying Purpose:{" "}
            {changeTarget === "email" ? "Change Email" : "Change Phone Number"}
          </p>
          <input
            type="text"
            placeholder="6-digit OTP"
            value={otpCode}
            onChange={(e) => setOtpCode(e.target.value)}
            required
            className="flex-1 p-2 border border-[#ddd] rounded bg-white text-base"
          />
          <div className="flex gap-2">
            <button type="submit" className="flex-1 p-3 bg-[#e53935] text-white border-none rounded text-base font-bold cursor-pointer hover:bg-[#d32f2f] disabled:opacity-70 disabled:cursor-not-allowed">
              Verify Code
            </button>
            <button
              type="button"
              className="flex-1 p-3 bg-[#e53935] text-white border-none rounded text-base font-bold cursor-pointer hover:bg-[#d32f2f] disabled:opacity-70 disabled:cursor-not-allowed"
              onClick={sendOtp}
              disabled={resendCd > 0}
            >
              {resendCd > 0 ? `Resend OTP (${resendCd}s)` : "Resend OTP"}
            </button>
          </div>
        </form>
      </div>
    );
  }
  return (
    <main className="flex flex-col min-h-screen">
      <Header/>

      <div className="flex-1">
        <div className="container">
          <div className="bg-white rounded-lg shadow-[var(--shadow)] p-6 max-w-[760px] my-6 mx-auto">
            <h1>My profile</h1>
            <p>Manage and protect your account</p>

            <hr className="my-5 border-0 border-t border-[#eee]" />
            <div className="flex flex-col items-center gap-6 mb-6">
              <img
                src={resolveAvatarUrl(user.avatarUrl)}
                alt="Profile Avatar"
                className="w-24 h-24 rounded-full object-cover border-2 border-[#eee] bg-[#f5f5f5]"
                onError={(event) => {
                  (event.currentTarget as HTMLImageElement).src = placeholderAvatarUrl;
                }}
              />
              <div>
                <input
                  type="file"
                  ref={fileInputRef}
                  style={{ display: "none" }}
                  accept="image/*"
                  onChange={handleChangeAvatar}
                />
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={triggerFileSelect}
                >
                  Change Avatar
                </button>
              </div>
            </div>

            <div className="flex gap-3 items-center my-2.5">
              <div className="w-[140px] font-semibold">Username</div>
              <div className="flex-1 p-2 text-[#666]">{user.username}</div>
            </div>

            <div className="flex gap-3 items-center my-2.5">
              <div className="w-[140px] font-semibold">Email</div>
              <div className="flex-1 p-2 text-[#666]">{user.email}</div>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => startOtpFlow("email")}
              >
                change
              </button>
            </div>

            <div className="flex gap-3 items-center my-2.5">
              <div className="w-[140px] font-semibold">Phone Number</div>
              <div className="flex-1 p-2 text-[#666]">{user.phoneNo}</div>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => startOtpFlow("phoneNo")}
              >
                change
              </button>
            </div>

            <hr className="my-5 border-0 border-t border-[#eee]" />

			<div className="flex gap-3 items-center my-2.5">
			  <div className="w-[140px] font-semibold">Password</div>
			  <div className="flex-1 p-2 text-[#666]">••••••••</div>
			  <button
				className="btn btn-secondary btn-sm"
				onClick={() => router.push("/profile/change-password")}
			  >
				change
			  </button>
			</div>

			<hr className="my-5 border-0 border-t border-[#eee]" />

            <div className="flex gap-3 items-center my-2.5">
              <div className="w-[140px] font-semibold">First Name</div>
              <input
                name="firstName"
                value={inputData.firstName}
                onChange={handleChange}
                className="flex-1 p-2 border border-[#ddd] rounded bg-white text-base"
              />
            </div>

            <div className="flex gap-3 items-center my-2.5">
              <div className="w-[140px] font-semibold">Last Name</div>
              <input
                name="lastName"
                value={inputData.lastName}
                onChange={handleChange}
                className="flex-1 p-2 border border-[#ddd] rounded bg-white text-base"
              />
            </div>

            <div className="flex gap-3 items-center my-2.5">
              <div className="w-[140px] font-semibold">Gender</div>
              <div className="flex gap-4 items-center">
                <div className="flex-1 p-2 text-[#666]">{user.gender}</div>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="radio"
                    name="gender"
                    value="Male"
                    checked={inputData.gender === "Male"}
                    onChange={handleChange}
                  />
                  Male
                </label>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="radio"
                    name="gender"
                    value="Female"
                    checked={inputData.gender === "Female"}
                    onChange={handleChange}
                  />
                  Female
                </label>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="radio"
                    name="gender"
                    value="PreferNotToTell"
                    checked={false}
                    onChange={() => {
                      showToast("Please choose your gender! 🏳️‍🌈", "success");
                    }}
                  />
                  Prefer not to tell
                </label>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() =>
                    setInputData((prev) => ({ ...prev, gender: "" }))
                  }
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="flex gap-3 items-center my-2.5">
              <div className="w-[140px] font-semibold">Date of birth</div>
              <div className="flex-1 p-2 text-[#666]">
                {user.dateOfBirth
                  ? new Date(user.dateOfBirth).toLocaleDateString()
                  : ""}
              </div>
              <input
                type="date"
                name="dateOfBirth"
                value={inputData.dateOfBirth}
                onChange={handleChange}
                max={today}
                min="1950-01-01"
              />
            </div>

            <div className="mt-6 border-t border-[#eee] pt-5">
              <button className="btn btn-primary" onClick={handleSave}>
                Save Profile Changes
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

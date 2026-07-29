"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Header from "@/components/Header/Header";
import ShopTabs from "@/components/ShopTabs/ShopTabs";
import ShopHeader from "@/components/ShopTabs/ShopHeader";
import BulkImport from "@/components/BulkImport/BulkImport";
import { useShopCounts } from "@/components/ShopTabs/useShopCounts";
import { useAuth } from '@/context/AuthContext';
import { useToast } from "@/components/Toast/ToastContext";
import { useI18n } from '@/context/LanguageContext';

// Shared with the bulk importer so its "accepted values" help stays in sync.
import { CATEGORIES, CONDITIONS, DEALING_METHODS } from "@/lib/productOptions";
const WEIGHT_CATEGORIES = ["1U", "2U", "3U", "4U", "5U", "6U", "7U", "8U"];
const FLEXIBILITY_CATEGORIES = [
  "Stiff Shaft",
  "Medium Flex",
  "High Flexibility",
];
const BALANCE_CATEGORIES = ["Head Heavy", "Even Balance", "Head Light"];
const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "";
const MAX_PHOTO_SIZE = 10 * 1024 * 1024;

type Condition = (typeof CONDITIONS)[number]; // treat conditions like this is enum, but string union type

/* ─────────────────────────────────────────
   Inner component – reads search params
───────────────────────────────────────── */

// first, prepare everything the page needs before display the form
function SellPageInner() {
	//initial setup, preparing the page state
	//router can navigate the page
  const router = useRouter();
  const searchParams = useSearchParams(); //reading value from parameter from URL,/sell?editId=42
  const editId = searchParams.get("editId"); // fetch editId, 42
  const isEditMode = !!editId; // turn value to true / false

  const { user } = useAuth(); // check is current user logged in?
  const { showToast } = useToast(); // display small message to user, a notification function, eg: listing created success, please login first
  const { t } = useI18n(); // for language translation
  const shopCounts = useShopCounts(); // tallies for the shared My Shop header/tabs
  // Which way of posting is open: the one-at-a-time form, or the CSV importer.
  const [mode, setMode] = useState<"single" | "bulk">("single");
  // Editing always targets one existing ad, so it pins the form regardless of
  // whatever mode was last picked.
  const activeMode = isEditMode ? "single" : mode;
  const fileInputRef = useRef<HTMLInputElement>(null); // create an invisible input box

	/* this block is temporary page state */

  //state variables, temp memory for the page, usually what is the current state
  const [step, setStep] = useState(isEditMode ? 2 : 1); // current page'stage
  const [searchInput, setSearchInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [editLoading, setEditLoading] = useState(isEditMode);

  // Step 1
  const [category, setCategory] = useState("Others");

  // Photos
  const [photos, setPhotos] = useState<File[]>([]);
  const [photoPreviewUrls, setPhotoPreviewUrls] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  // what information does the form remember?
  // Details & Pricing
  // form state
  const [condition, setCondition] = useState<Condition>("Second-hand (Used)");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [stockQuantity, setStockQuantity] = useState("1");
  const [location, setLocation] = useState("");
  const [dealingMethods, setDealingMethods] = useState<string[]>([]);
  const [weightCategory, setWeightCategory] = useState("4U");
  const [flexibilityCategory, setFlexibilityCategory] = useState("Medium Flex");
  const [balanceCategory, setBalanceCategory] = useState("Even Balance");
  // Contact
  const [phoneNumber, setPhoneNumber] = useState("");
  // Acknowledgement
  const [acknowledged, setAcknowledged] = useState(false);
  /* this block is temporary page state */

  /* Load listing data in edit mode, editing an existing listing */
  /* this is about when user trying to edit the existing listing, call api, fetch data from postgreSQL to make amendment */
  useEffect(() => {
    if (!editId) return;
    setEditLoading(true);
    const token = localStorage.getItem("token") || "";
    fetch(`/api/v1/products/${editId}`,
      token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
    )
      .then((r) => r.json())	// take api response and fills the edit form, read response body and convert to javaScript object
      //Take the existing listing data returned by the backend, convert it into the formats expected by the frontend, and fill the edit form.
	  .then((p) => {
        setCategory(p.category || "Others");
        if (CONDITIONS.includes(p.condition))
          setCondition(p.condition as Condition);
        setTitle(p.title || "");
        setDescription(p.description || "");
        setPrice(p.price?.toString() || "");
        setStockQuantity((p.stockQuantity ?? 1).toString());
        setLocation(p.location || "");
        setDealingMethods(
          p.dealingMethod ? p.dealingMethod.split(", ").filter(Boolean) : [],
        );
        setPhoneNumber(p.phoneNumber || "");
        setWeightCategory(p.weightCategory || "4U");
        setFlexibilityCategory(p.flexibilityCategory || "Medium Flex");
        setBalanceCategory(p.balanceCategory || "Even Balance");
      })
      .catch(() => showToast("Failed to load listing data", "error"))
      .finally(() => setEditLoading(false));
  }, [editId]); // eslint-disable-line react-hooks/exhaustive-deps
/* this is about when user trying to edit the existing listing, call api, fetch data from postgreSQL to make amendment */

/* possible unused / redundance code*/
  const handleSearch = () => {
    if (!searchInput.trim()) {
      router.push("/");
      return;
    }
    router.push(`/?search=${encodeURIComponent(searchInput.trim())}`);
  };
  /* possible unused / redundance code*/

  // clars the current frontend form state
  const handleClearAll = () => {
    setCategory("Others");
    photoPreviewUrls.forEach((u) => URL.revokeObjectURL(u));
    setPhotos([]);
    setPhotoPreviewUrls([]);
    setCondition("Second-hand (Used)");
    setTitle("");
    setDescription("");
    setPrice("");
    setStockQuantity("1");
    setLocation("");
    setDealingMethods([]);
    setPhoneNumber("");
    setAcknowledged(false);
    setWeightCategory("4U");
    setFlexibilityCategory("Medium Flex");
    setBalanceCategory("Even Balance");
    if (!isEditMode) setStep(1);
  };

  /* 
 	keep only image file
	reject image larger than 10 mb
	max 6 photos
	show error for invalid files
	stop if no valid files remain
	create preview url and store them in photoPreviewUrls
  */
  const addPhotos = (files: File[]) => {
    const valid = files.filter((f) => f.type.startsWith("image/"));
    const uploadable = valid.filter((f) => f.size <= MAX_PHOTO_SIZE);
    const slots = 6 - photos.length;
    const newFiles = uploadable.slice(0, slots);
    if (valid.length !== files.length)
      showToast("Only image files can be uploaded", "error");
    if (uploadable.length !== valid.length)
      showToast("Each photo must be 10MB or smaller", "error");
    if (uploadable.length > slots)
      showToast("You can upload up to 6 photos", "error");
    if (!newFiles.length) return;
    setPhotos((prev) => [...prev, ...newFiles]); //append new photo
    setPhotoPreviewUrls((prev) => [
      ...prev,
      ...newFiles.map((f) => URL.createObjectURL(f)), // create previews
    ]);
  };

  const removePhoto = (i: number) => {
    URL.revokeObjectURL(photoPreviewUrls[i]);
    setPhotos((prev) => prev.filter((_, j) => j !== i));
    setPhotoPreviewUrls((prev) => prev.filter((_, j) => j !== i));
  };

  // meet up vs mailing or dealing
  const toggleDealingMethod = (m: string) =>
    setDealingMethods((prev) =>
      prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m],
    );

	//upload to go backend
  const uploadPhotos = async (listingId: number, token: string) => {
    if (!photos.length) return;
    const fd = new FormData(); //this is to create special request body that can hold files
    photos.forEach((p) => fd.append("images", p)); //add selected photo to fd
    // const res = await fetch(`${API_BASE}/api/v1/products/${listingId}/images`, { // conflict happen during merging. this is howaikeong code. I am taking mad code which is below
    //send the files to the backend endpoint for that listing
	const res = await fetch(`/api/v1/products/${listingId}/images`, { //recheck mad add
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });
    if (!res.ok) {
      const e = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(e.error || "Failed to upload listing photos");
    }
  };

  const handleSubmit = async () => {
    
	/* validation */
	if (!user) {
      showToast("Please login first", "error");
      router.push("/login");
      return;
    }
    if (!title.trim()) {
      showToast("Ad title is required", "error");
      return;
    }
    const parsedPrice = parseFloat(price);
    if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
      showToast("Please enter a valid price", "error");
      return;
    }
    const parsedStockQuantity = Number.parseInt(stockQuantity, 10);
    if (!Number.isInteger(parsedStockQuantity) || parsedStockQuantity < 1) {
      showToast("Please enter a valid stock quantity", "error");
      return;
    }
    if (!dealingMethods.length) {
      showToast("Please select at least one dealing method", "error");
      return;
    }
    if (!acknowledged) {
      showToast("Please confirm the acknowledgement", "error");
      return;
    }
	/* validation */

	//authentication setup
    setSubmitting(true);
    const token = localStorage.getItem("token") || "";
    if (!token) {
      showToast("Please login again", "error");
      router.push("/login");
      return;
    }

	//edit existing listing
    try {
      if (isEditMode) {
        /* ── UPDATE ── */
        const res = await fetch(
          // `${API_BASE}/api/v1/products/${editId}`, // conflict happen during merging. this is howaikeong code. I am taking mad code which is below
          `/api/v1/products/${editId}`,
          {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              category,
              condition,
              dealingMethod: dealingMethods.join(", "),
              phoneNumber,
              title: title.trim(),
              description: description.trim(),
              price: parsedPrice,
              stockQuantity: parsedStockQuantity,
              location: location.trim() || "Malaysia",
              weightCategory,
              flexibilityCategory,
              balanceCategory,
              status: "active",
            }),
          },
        );
        if (!res.ok) {
          const e = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(e.error || "Failed to update listing");
        }
        await uploadPhotos(Number(editId), token);
        showToast("Ad updated successfully", "success");
        router.push("/profile/my-ads");
      } else {
        /* ── CREATE new listing ── */
        // const res = await fetch(`${API_BASE}/api/v1/products`, { // conflict happen during merging. this is howaikeong code. I am taking mad code which is below
        const res = await fetch("/api/v1/products", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            category,
            condition,
            dealingMethod: dealingMethods.join(", "),
            phoneNumber,
            title: title.trim(),
            description: description.trim(),
            price: parsedPrice,
            stockQuantity: parsedStockQuantity,
            location: location.trim() || "Malaysia",
            weightCategory,
            flexibilityCategory,
            balanceCategory,
            isNew: condition === "New",
            isFeatured: false,
          }),
        });
        if (!res.ok) {
          const e = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(e.error || "Failed to create listing");
        }
        const created = await res.json();
        await uploadPhotos(created.id, token);
        showToast(t('toast.listingCreated'), 'success');
        setStep(3);
      }
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Something went wrong",
        "error",
      );
    } finally {
      setSubmitting(false);
    }
  };
  //progress bar
  const progressPercent = step === 1 ? 33 : step === 2 ? 66 : 100;

  if (editLoading) {
    return (
      <main className="min-h-screen bg-[#f0f0f0]">
        <Header/>
        <div className="p-12 text-center text-[#666] text-base">Loading listing data…</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f0f0f0]">
      <Header/>

      {/* Shared My Shop header + row, so the top of this page matches My Shop. */}
      <div className="max-w-[1140px] mx-auto pt-7 px-4">
        <ShopHeader counts={shopCounts} />
        <div className="bg-white rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.1)] overflow-hidden">
          <ShopTabs current="sell" counts={shopCounts ?? undefined} />
        </div>
      </div>

      <div className="flex max-w-[1140px] mx-auto pt-6 px-4 pb-14 gap-6 items-start max-[860px]:flex-col">
        {/* ── SIDEBAR ── */}
        <aside className="w-[260px] shrink-0 max-[860px]:w-full">
          <div className="bg-white rounded-lg p-5 shadow-[0_1px_3px_rgba(0,0,0,0.1)] sticky top-6 max-[860px]:static">
            <h2 className="text-lg font-bold m-0 text-[#222]">Post An Ad</h2>
            <p className="text-xs text-[#888] mt-1 mx-0 mb-3">Sell Your Stuff</p>

            {/* Mode chooser. Hidden while editing — that always targets one ad. */}
            {!isEditMode && (
              <div className="flex flex-col gap-2 mb-5">
                {(
                  [
                    { id: 'single', icon: '📝', label: t('sell.modeSingle'), hint: t('sell.modeSingleHint') },
                    { id: 'bulk', icon: '📥', label: t('sell.modeBulk'), hint: t('sell.modeBulkHint') },
                  ] as const
                ).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMode(m.id)}
                    className={`w-full text-left flex gap-2.5 items-start px-3.5 py-3 rounded-lg border cursor-pointer transition-all duration-150 ${
                      mode === m.id
                        ? 'bg-[#fce4ec] border-[#f48fb1]'
                        : 'bg-white border-[#e0e0e0] hover:border-[#888]'
                    }`}
                  >
                    <span className="text-base leading-none mt-px shrink-0">{m.icon}</span>
                    <span className="min-w-0">
                      <span
                        className={`block text-[13.5px] ${mode === m.id ? 'font-bold text-[#c2185b]' : 'font-semibold text-[#333]'}`}
                      >
                        {m.label}
                      </span>
                      <span className="block text-[11.5px] text-[#898781] mt-0.5">{m.hint}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}

            {activeMode === 'bulk' ? (
              <div className="border-t border-[#eee] pt-4">
                <p className="text-[13px] font-semibold text-[#333] mt-0 mx-0 mb-2">
                  {t('import.howToTitle')}
                </p>
                <ol className="list-decimal mt-0 mx-0 mb-0 pl-[18px] flex flex-col gap-1.5 text-[12.5px] text-[#555] leading-[1.5]">
                  <li>{t('import.step1')}</li>
                  <li>{t('import.step2')}</li>
                  <li>{t('import.step3')}</li>
                </ol>
              </div>
            ) : (
            <>
            <div className="h-1 bg-[#e0e0e0] rounded-sm mb-5">
              <div
                className="h-full bg-[#22c55e] rounded-sm transition-[width] duration-[400ms] ease-in-out"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <ul className="list-none m-0 p-0 flex flex-col gap-4">
              <li
                className={`flex items-center gap-2.5 text-sm ${step > 1 || isEditMode ? "text-[#22c55e] font-semibold [&>span:first-child]:bg-[#22c55e] [&>span:first-child]:text-white" : step === 1 ? "text-[#222] font-semibold [&>span:first-child]:bg-[#222] [&>span:first-child]:text-white" : "text-[#aaa] font-medium [&>span:first-child]:bg-[#e0e0e0] [&>span:first-child]:text-[#888]"}`}
              >
                <span className="w-7 h-7 rounded-full flex items-center justify-center text-[13px] font-bold shrink-0 transition-[background-color,color] duration-300">
                  {step > 1 || isEditMode ? "✓" : "1"}
                </span>
                <span>Basic Information</span>
              </li>
              <li
                className={`flex items-center gap-2.5 text-sm ${step > 2 ? "text-[#22c55e] font-semibold [&>span:first-child]:bg-[#22c55e] [&>span:first-child]:text-white" : step === 2 ? "text-[#222] font-semibold [&>span:first-child]:bg-[#222] [&>span:first-child]:text-white" : "text-[#aaa] font-medium [&>span:first-child]:bg-[#e0e0e0] [&>span:first-child]:text-[#888]"}`}
              >
                <span className="w-7 h-7 rounded-full flex items-center justify-center text-[13px] font-bold shrink-0 transition-[background-color,color] duration-300">2</span>
                <span>Ad Details</span>
              </li>
              {step === 2 && (
                <ul className="list-none mt-1 mx-0 mb-0 pt-0 pr-0 pb-0 pl-[38px] flex flex-col gap-2">
                  <li className="text-[13px] text-[#555]">Photos</li>
                  <li className="text-[13px] text-[#555]">Details &amp; Pricing</li>
                  <li className="text-[13px] text-[#555]">Contact</li>
                  <li className="text-[13px] text-[#555]">Acknowledgment</li>
                </ul>
              )}
              <li
                className={`flex items-center gap-2.5 text-sm ${step === 3 ? "text-[#22c55e] font-semibold [&>span:first-child]:bg-[#22c55e] [&>span:first-child]:text-white" : "text-[#aaa] font-medium [&>span:first-child]:bg-[#e0e0e0] [&>span:first-child]:text-[#888]"}`}
              >
                <span className="w-7 h-7 rounded-full flex items-center justify-center text-[13px] font-bold shrink-0 transition-[background-color,color] duration-300">{step === 3 ? "✓" : "3"}</span>
                <span>Ad Successfully Submitted</span>
              </li>
            </ul>
            </>
            )}
          </div>
        </aside>

        {/* ── CONTENT ── */}
        <div className="flex-1 flex flex-col gap-4 min-w-0">
          {activeMode === 'bulk' ? (
            <>
              <div>
                <h2 className="text-xl font-bold text-[#222] mt-0 mx-0 mb-1.5">
                  {t('import.heading')}
                </h2>
                <p className="text-[#898781] text-sm m-0">
                  {t('import.subheading', { max: 500 })}
                </p>
              </div>
              <BulkImport />
            </>
          ) : (
          <>
          <div className="flex justify-between items-center min-h-6">
            {step === 2 && !isEditMode && (
              <button className="bg-none border-none text-[#22c55e] font-bold cursor-pointer text-sm p-0 tracking-[0.3px] hover:underline" onClick={() => setStep(1)}>
                ← BACK
              </button>
            )}
            {step !== 3 && (
              <button className="bg-none border-none text-[#22c55e] font-bold cursor-pointer text-sm p-0 ml-auto tracking-[0.3px] hover:underline" onClick={handleClearAll}>
                CLEAR ALL
              </button>
            )}
          </div>

          {/* ── STEP 1: Category ── */}
          {step === 1 && (
            <div className="bg-white rounded-lg p-6 shadow-[0_1px_3px_rgba(0,0,0,0.1)]">
              <h2 className="text-xl font-bold mt-0 mx-0 mb-2 text-[#222]">What Would You Like to Post?</h2>
              <div className="border border-[#e0e0e0] rounded-lg overflow-hidden my-4 mx-0">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    className={`flex justify-between items-center px-4 py-3.5 border-0 border-solid border-b border-b-[#e0e0e0] cursor-pointer text-[15px] w-full text-left transition-colors duration-150 last:border-b-0 ${category === cat ? "bg-[#f0fdf4] text-[#16a34a] font-semibold" : "bg-white text-[#333] hover:bg-[#f9f9f9]"}`}
                    onClick={() => setCategory(cat)}
                  >
                    <span>{cat}</span>
                    <span className="text-[#bbb] text-lg">›</span>
                  </button>
                ))}
              </div>
              <div className="flex justify-end mt-4">
                <button
                  className="bg-[#2563eb] text-white border-none rounded-md px-8 py-3 text-sm font-bold cursor-pointer tracking-[0.5px] transition-colors duration-150 hover:bg-[#1d4ed8] disabled:bg-[#93c5fd] disabled:cursor-not-allowed"
                  onClick={() => {
                    if (!category) {
                      showToast("Please select a category", "error");
                      return;
                    }
                    setStep(2);
                  }}
                >
                  CONTINUE
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 2: Ad Details ── */}
          {step === 2 && (
            <>
              {/* Photos */}
              <div className="bg-white rounded-lg p-6 shadow-[0_1px_3px_rgba(0,0,0,0.1)]">
                <h2 className="text-xl font-bold mt-0 mx-0 mb-2 text-[#222]">Photos for Your Ad</h2>
                <p className="text-sm text-[#22c55e] mt-0 mx-0 mb-1">
                  Capture as much detail in your photographs to attract more
                  potential buyers.
                </p>

                <div
                  className={`border-2 border-dashed rounded-lg p-[18px] text-center cursor-pointer text-[#888] text-sm mb-4 transition-[border-color,background-color] duration-200 select-none ${isDragging ? "border-[#2563eb] bg-[#dbeafe]" : "border-[#ccc] hover:border-[#2563eb] hover:bg-[#f0f7ff]"}`}
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDragging(false);
                    addPhotos(Array.from(e.dataTransfer.files));
                  }}
                >
                  ↓ Drop your files here to upload
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  style={{ display: "none" }}
                  onChange={(e) => addPhotos(Array.from(e.target.files || []))}
                />

                <div className="grid grid-cols-5 gap-2 mb-2 max-[860px]:grid-cols-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div
                      key={i}
                      className="aspect-square border border-[#ddd] rounded-md overflow-hidden cursor-pointer bg-[#f9f9f9] relative transition-[border-color] duration-150 hover:border-[#aaa]"
                      onClick={() =>
                        !photoPreviewUrls[i] && fileInputRef.current?.click()
                      }
                    >
                      {photoPreviewUrls[i] ? (
                        <div className="w-full h-full relative">
                          <img
                            className="w-full h-full object-cover block"
                            src={photoPreviewUrls[i]}
                            alt={`photo ${i + 1}`}
                          />
                          <button
                            className="absolute top-[3px] right-[3px] w-5 h-5 rounded-full bg-black/55 text-white border-none cursor-pointer text-base flex items-center justify-center leading-none p-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              removePhoto(i);
                            }}
                          >
                            ×
                          </button>
                        </div>
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center gap-1">
                          <span className="text-[22px] opacity-50">📷</span>
                          {i === 0 && (
                            <span className="text-[10px] text-[#aaa] text-center px-1">
                              Add cover photo
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <p className="text-right text-xs text-[#888] m-0">
                  {photos.length} of 6 photos uploaded
                </p>
              </div>

              {/* Details & Pricing */}
              <div className="bg-white rounded-lg p-6 shadow-[0_1px_3px_rgba(0,0,0,0.1)]">
                <h2 className="text-xl font-bold mt-0 mx-0 mb-2 text-[#222]">
                  Ad Details, Description &amp; Pricing
                </h2>
                <p className="text-sm text-[#22c55e] mt-0 mx-0 mb-1">
                  Complete your ad details, then write a good title &amp;
                  description about the item you want to post.
                </p>
                <p className="text-[13px] text-[#f59e0b] mt-0 mx-0 mb-5">
                  Note: Avoid inserting your personal information in this
                  section.
                </p>

                {/* Condition */}
                <div className="mb-5">
                  <h3 className="text-[15px] font-semibold mt-0 mx-0 mb-2.5 text-[#222]">Select item condition</h3>
                  <div className="flex gap-2.5 flex-wrap">
                    {CONDITIONS.map((c) => (
                      <button
                        key={c}
                        className={`px-5 py-2 border rounded-[20px] cursor-pointer text-sm transition-all duration-150 ${condition === c ? "bg-[#eff6ff] border-[#2563eb] text-[#2563eb] font-semibold" : "bg-white border-[#ccc] text-[#333] hover:border-[#555]"}`}
                        onClick={() => setCondition(c)}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Title */}
                <div className="mb-5">
                  <input
                    className="w-full border border-[#ccc] rounded-md px-3.5 py-3 text-[15px] text-[#333] bg-white box-border outline-none transition-[border-color] duration-150 focus:border-[#2563eb]"
                    placeholder="Ad Title"
                    maxLength={50}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                  <p className="text-right text-xs text-[#888] mt-1 mx-0 mb-0">{title.length}/50</p>
                </div>

                {/* Description */}
                <div className="mb-5">
                  <textarea
                    className="w-full border border-[#ccc] rounded-md px-3.5 py-3 text-[15px] text-[#333] bg-white resize-y min-h-[140px] box-border outline-none transition-[border-color] duration-150 font-[inherit] focus:border-[#2563eb]"
                    placeholder="Description"
                    maxLength={8000}
                    rows={6}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                  <p className="text-[11px] text-[#aaa] mt-1 mx-0 mb-0 leading-[1.5]">
                    Describe the goods/services accurately by including the
                    price, delivery arrangements, methods of payment, etc., if
                    applicable.
                  </p>
                  <p className="text-right text-xs text-[#888] mt-1 mx-0 mb-0">{description.length}/8000</p>
                </div>

                {/* Price */}
                <div className="mb-5">
                  <div className="flex items-center border border-[#ccc] rounded-md overflow-hidden transition-[border-color] duration-150 focus-within:border-[#2563eb]">
                    <span className="px-3.5 py-3 bg-[#f5f5f5] border-r border-[#ccc] font-semibold text-[#555] text-[15px] shrink-0">RM</span>
                    <input
                      type="number"
                      className="w-full border-none rounded-none flex-1 px-3.5 py-3 text-[15px] text-[#333] bg-white box-border outline-none focus:outline-none focus:shadow-none"
                      placeholder="Price"
                      min="0"
                      step="0.01"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                    />
                  </div>
                </div>

                {/* Stock */}
                <div className="mb-5">
                  <input
                    type="number"
                    className="w-full border border-[#ccc] rounded-md px-3.5 py-3 text-[15px] text-[#333] bg-white box-border outline-none transition-[border-color] duration-150 focus:border-[#2563eb]"
                    placeholder="Stock quantity"
                    min="1"
                    step="1"
                    value={stockQuantity}
                    onChange={(e) => setStockQuantity(e.target.value.replace(/[^\d]/g, ""))}
                  />
                  <p className="text-[11px] text-[#aaa] mt-1 mx-0 mb-0 leading-[1.5]">
                    Use 1 for a single second-hand item, or more if you have
                    identical units available.
                  </p>
                </div>

                {/* Location */}
                <div className="mb-5">
                  <div className="flex items-center border border-[#ccc] rounded-md overflow-hidden transition-[border-color] duration-150 focus-within:border-[#2563eb]">
                    <input
                      className="w-full border-none rounded-none flex-1 px-3.5 py-3 text-[15px] text-[#333] bg-white box-border outline-none focus:outline-none focus:shadow-none"
                      placeholder="Location"
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                    />
                    <span className="px-3.5 py-3 text-[#888]">🔍</span>
                  </div>
                </div>

                {/* Racket specs (shown only for Rackets category) */}
                {category === "Rackets" && (
                  <div className="mb-5">
                    <h3 className="text-[15px] font-semibold mt-0 mx-0 mb-2.5 text-[#222]">Racket Specifications</h3>
                    <div className="grid grid-cols-3 gap-3 max-[860px]:grid-cols-1">
                      <div>
                        <label className="block text-[13px] text-[#666] mb-1">Weight</label>
                        <select
                          className="w-full border border-[#ccc] rounded-md px-3 py-2.5 text-sm text-[#333] bg-white outline-none transition-[border-color] duration-150 focus:border-[#2563eb]"
                          value={weightCategory}
                          onChange={(e) => setWeightCategory(e.target.value)}
                        >
                          {WEIGHT_CATEGORIES.map((w) => (
                            <option key={w}>{w}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[13px] text-[#666] mb-1">Flexibility</label>
                        <select
                          className="w-full border border-[#ccc] rounded-md px-3 py-2.5 text-sm text-[#333] bg-white outline-none transition-[border-color] duration-150 focus:border-[#2563eb]"
                          value={flexibilityCategory}
                          onChange={(e) =>
                            setFlexibilityCategory(e.target.value)
                          }
                        >
                          {FLEXIBILITY_CATEGORIES.map((f) => (
                            <option key={f}>{f}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[13px] text-[#666] mb-1">Balance</label>
                        <select
                          className="w-full border border-[#ccc] rounded-md px-3 py-2.5 text-sm text-[#333] bg-white outline-none transition-[border-color] duration-150 focus:border-[#2563eb]"
                          value={balanceCategory}
                          onChange={(e) => setBalanceCategory(e.target.value)}
                        >
                          {BALANCE_CATEGORIES.map((b) => (
                            <option key={b}>{b}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                )}

                {/* Dealing method */}
                <div className="mb-5">
                  <div className="flex justify-between items-center mb-2.5">
                    <h3 className="text-[15px] font-semibold mt-0 mx-0 mb-2.5 text-[#222]">
                      What is your dealing method?
                    </h3>
                    <button
                      className="bg-none border-none text-[#22c55e] text-sm font-semibold cursor-pointer p-0"
                      onClick={() => setDealingMethods([...DEALING_METHODS])}
                    >
                      Select All
                    </button>
                  </div>
                  <div className="flex gap-2.5 flex-wrap">
                    {DEALING_METHODS.map((m) => (
                      <button
                        key={m}
                        className={`px-5 py-2 border rounded-[20px] cursor-pointer text-sm transition-all duration-150 ${dealingMethods.includes(m) ? "bg-[#fffbeb] border-[#f59e0b] text-[#d97706] font-semibold" : "bg-white border-[#ccc] text-[#333] hover:border-[#555]"}`}
                        onClick={() => toggleDealingMethod(m)}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Contact */}
              <div className="bg-white rounded-lg p-6 shadow-[0_1px_3px_rgba(0,0,0,0.1)]">
                <h2 className="text-xl font-bold mt-0 mx-0 mb-2 text-[#222]">Contact</h2>
                <div className="mb-5">
                  <input
                    className="w-full border border-[#ccc] rounded-md px-3.5 py-3 text-[15px] text-[#333] bg-white box-border outline-none transition-[border-color] duration-150 focus:border-[#2563eb]"
                    placeholder="Phone Number"
                    maxLength={15}
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                  />
                  <p className="text-[11px] text-[#aaa] mt-1 mx-0 mb-0 leading-[1.5]">
                    Enter your phone number (e.g. 01212345678)
                  </p>
                  <p className="text-right text-xs text-[#888] mt-1 mx-0 mb-0">{phoneNumber.length}/15</p>
                </div>
              </div>

              {/* Acknowledgement */}
              <div className="bg-white rounded-lg p-6 shadow-[0_1px_3px_rgba(0,0,0,0.1)]">
                <h2 className="text-xl font-bold mt-0 mx-0 mb-2 text-[#222]">Acknowledgement</h2>
                <p className="text-sm text-[#555] mt-0 mx-0 mb-4">
                  This platform does not allow counterfeit goods to be sold
                  through the site.
                </p>
                <label className="flex items-center justify-between gap-4 cursor-pointer py-3 border-t border-[#eee]">
                  <span className="text-[15px] text-[#22c55e] italic flex-1">
                    I hereby confirm that the goods I&apos;m selling are
                    original and not counterfeit.
                  </span>
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    onChange={(e) => setAcknowledged(e.target.checked)}
                    className="w-5 h-5 cursor-pointer shrink-0"
                  />
                </label>
              </div>

              {/* Submit buttons */}
              <div className="flex justify-end gap-3">
                <button className="px-7 py-3 border border-[#555] bg-white rounded-md text-sm font-bold cursor-pointer text-[#333] tracking-[0.5px] transition-colors duration-150 enabled:hover:bg-[#f5f5f5] disabled:opacity-50 disabled:cursor-not-allowed" disabled={submitting}>
                  PREVIEW AD
                </button>
                <button
                  className="px-7 py-3 bg-[#2563eb] text-white border-none rounded-md text-sm font-bold cursor-pointer tracking-[0.5px] transition-colors duration-150 enabled:hover:bg-[#1d4ed8] disabled:bg-[#93c5fd] disabled:cursor-not-allowed"
                  disabled={submitting}
                  onClick={handleSubmit}
                >
                  {submitting
                    ? "SUBMITTING…"
                    : isEditMode
                      ? "SAVE CHANGES"
                      : "SUBMIT NOW"}
                </button>
              </div>
              <p className="text-xs text-[#888] text-center leading-[1.6] m-0">
                By submitting the ad, I confirm that I have read and agreed to
                the Rules of Advertising, Terms &amp; Conditions of this
                platform.
              </p>
            </>
          )}

          {/* ── STEP 3: Success ── */}
          {step === 3 && (
            <div className="bg-white rounded-lg p-6 shadow-[0_1px_3px_rgba(0,0,0,0.1)]">
              <div className="flex flex-col items-center px-5 py-12 text-center">
                <div className="text-[64px] mb-4">🎉</div>
                <h2 className="text-[28px] font-bold text-[#222] mt-0 mx-0 mb-2">
                  Ad Successfully Submitted!
                </h2>
                <p className="text-base text-[#666] mt-0 mx-0 mb-8">
                  Your ad has been posted and will be visible to buyers shortly.
                </p>
                <div className="flex gap-4 flex-wrap justify-center">
                  <button
                    className="bg-[#2563eb] text-white border-none rounded-md px-8 py-3 text-sm font-bold cursor-pointer tracking-[0.5px] transition-colors duration-150 hover:bg-[#1d4ed8] disabled:bg-[#93c5fd] disabled:cursor-not-allowed"
                    onClick={() => router.push("/profile/my-ads")}
                  >
                    VIEW MY ADS
                  </button>
                  <button
                    className="px-7 py-3 border border-[#555] bg-white rounded-md text-sm font-bold cursor-pointer text-[#333] tracking-[0.5px] transition-colors duration-150 enabled:hover:bg-[#f5f5f5] disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={handleClearAll}
                  >
                    POST ANOTHER AD
                  </button>
                </div>
              </div>
            </div>
          )}
          </>
          )}
        </div>
      </div>
    </main>
  );
}

/* ─────────────────────────────────────────
   Page export – wraps inner in Suspense
   (required by Next.js for useSearchParams)
───────────────────────────────────────── */
export default function SellPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24 }}>Loading…</div>}>
      <SellPageInner />
    </Suspense>
  );
}

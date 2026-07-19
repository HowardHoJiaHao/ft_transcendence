"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Header from "@/components/Header/Header";
import { useAuth } from '@/context/AuthContext';
import { useToast } from "@/components/Toast/ToastContext";
import { useI18n } from '@/context/LanguageContext';
import styles from "./sell.module.css";

const CATEGORIES = [
  "Rackets",
  "Grips",
  "Shuttlecocks",
  "Racket Bags & Covers",
  "Strings",
  "Shoes",
  "Apparel",
  "Accessories",
  "Others",
];
const CONDITIONS = ["Second-hand (Used)", "New", "Refurbished"] as const;
const DEALING_METHODS = ["Meet Up", "Mailing or Delivery"];
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
  "http://localhost:8080";
const MAX_PHOTO_SIZE = 10 * 1024 * 1024;

type Condition = (typeof CONDITIONS)[number];

/* ─────────────────────────────────────────
   Inner component – reads search params
───────────────────────────────────────── */
function SellPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get("editId");
  const isEditMode = !!editId;

  const { user } = useAuth();
  const { showToast } = useToast();
  const { t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState(isEditMode ? 2 : 1);
  const [searchInput, setSearchInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [editLoading, setEditLoading] = useState(isEditMode);

  // Step 1
  const [category, setCategory] = useState("Others");

  // Photos
  const [photos, setPhotos] = useState<File[]>([]);
  const [photoPreviewUrls, setPhotoPreviewUrls] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  // Details & Pricing
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

  /* Load listing data in edit mode */
  useEffect(() => {
    if (!editId) return;
    setEditLoading(true);
    //fetch(`${API_BASE}/api/v1/products/${editId}`) // conflict happen during merging. this is howaikeong code. I am taking mad code which is below
    fetch(`/api/v1/products/${editId}`)
      .then((r) => r.json())
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

  const handleSearch = () => {
    if (!searchInput.trim()) {
      router.push("/");
      return;
    }
    router.push(`/?search=${encodeURIComponent(searchInput.trim())}`);
  };

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
    setPhotos((prev) => [...prev, ...newFiles]);
    setPhotoPreviewUrls((prev) => [
      ...prev,
      ...newFiles.map((f) => URL.createObjectURL(f)),
    ]);
  };

  const removePhoto = (i: number) => {
    URL.revokeObjectURL(photoPreviewUrls[i]);
    setPhotos((prev) => prev.filter((_, j) => j !== i));
    setPhotoPreviewUrls((prev) => prev.filter((_, j) => j !== i));
  };

  const toggleDealingMethod = (m: string) =>
    setDealingMethods((prev) =>
      prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m],
    );

  const uploadPhotos = async (listingId: number, token: string) => {
    if (!photos.length) return;
    const fd = new FormData();
    photos.forEach((p) => fd.append("images", p));
    // const res = await fetch(`${API_BASE}/api/v1/products/${listingId}/images`, { // conflict happen during merging. this is howaikeong code. I am taking mad code which is below
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

    setSubmitting(true);
    const token = localStorage.getItem("token") || "";
    if (!token) {
      showToast("Please login again", "error");
      router.push("/login");
      return;
    }

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
        /* ── CREATE ── */
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

  const progressPercent = step === 1 ? 33 : step === 2 ? 66 : 100;

  if (editLoading) {
    return (
      <main className={styles.main}>
        <Header/>
        <div className={styles.loadingWrap}>Loading listing data…</div>
      </main>
    );
  }

  return (
    <main className={styles.main}>
      <Header/>

      <div className={styles.pageLayout}>
        {/* ── SIDEBAR ── */}
        <aside className={styles.sidebar}>
          <div className={styles.sidebarInner}>
            <h2 className={styles.sidebarTitle}>Post An Ad</h2>
            <p className={styles.sidebarSubtitle}>Sell Your Stuff</p>
            <div className={styles.progressBar}>
              <div
                className={styles.progressFill}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <ul className={styles.stepList}>
              <li
                className={`${styles.stepItem} ${step === 1 ? styles.stepActive : ""} ${step > 1 || isEditMode ? styles.stepDone : ""}`}
              >
                <span className={styles.stepNum}>
                  {step > 1 || isEditMode ? "✓" : "1"}
                </span>
                <span>Basic Information</span>
              </li>
              <li
                className={`${styles.stepItem} ${step === 2 ? styles.stepActive : ""} ${step > 2 ? styles.stepDone : ""}`}
              >
                <span className={styles.stepNum}>2</span>
                <span>Ad Details</span>
              </li>
              {step === 2 && (
                <ul className={styles.subStepList}>
                  <li className={styles.subStepItem}>Photos</li>
                  <li className={styles.subStepItem}>Details &amp; Pricing</li>
                  <li className={styles.subStepItem}>Contact</li>
                  <li className={styles.subStepItem}>Acknowledgment</li>
                </ul>
              )}
              <li
                className={`${styles.stepItem} ${step === 3 ? styles.stepDone : ""}`}
              >
                <span className={styles.stepNum}>{step === 3 ? "✓" : "3"}</span>
                <span>Ad Successfully Submitted</span>
              </li>
            </ul>

            {/* Shortcut to bulk CSV import for sellers with many products */}
            <div className={styles.bulkImportBox}>
              <p className={styles.bulkImportText}>{t('sell.bulkHint')}</p>
              <Link href="/profile/my-ads/import" className={styles.bulkImportBtn}>
                {t('myShop.importCsv')}
              </Link>
            </div>
          </div>
        </aside>

        {/* ── CONTENT ── */}
        <div className={styles.contentArea}>
          <div className={styles.topBar}>
            {step === 2 && !isEditMode && (
              <button className={styles.backBtn} onClick={() => setStep(1)}>
                ← BACK
              </button>
            )}
            {step !== 3 && (
              <button className={styles.clearAllBtn} onClick={handleClearAll}>
                CLEAR ALL
              </button>
            )}
          </div>

          {/* ── STEP 1: Category ── */}
          {step === 1 && (
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>What Would You Like to Post?</h2>
              <div className={styles.categoryList}>
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    className={`${styles.categoryItem} ${category === cat ? styles.categorySelected : ""}`}
                    onClick={() => setCategory(cat)}
                  >
                    <span>{cat}</span>
                    <span className={styles.categoryArrow}>›</span>
                  </button>
                ))}
              </div>
              <div className={styles.stepFooter}>
                <button
                  className={styles.continueBtn}
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
              <div className={styles.card}>
                <h2 className={styles.cardTitle}>Photos for Your Ad</h2>
                <p className={styles.cardSubtitle}>
                  Capture as much detail in your photographs to attract more
                  potential buyers.
                </p>

                <div
                  className={`${styles.dropZone} ${isDragging ? styles.dropZoneDragging : ""}`}
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

                <div className={styles.photoGrid}>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div
                      key={i}
                      className={`${styles.photoSlot} ${i === 0 ? styles.photoSlotCover : ""}`}
                      onClick={() =>
                        !photoPreviewUrls[i] && fileInputRef.current?.click()
                      }
                    >
                      {photoPreviewUrls[i] ? (
                        <div className={styles.photoThumb}>
                          <img
                            src={photoPreviewUrls[i]}
                            alt={`photo ${i + 1}`}
                          />
                          <button
                            className={styles.removePhotoBtn}
                            onClick={(e) => {
                              e.stopPropagation();
                              removePhoto(i);
                            }}
                          >
                            ×
                          </button>
                        </div>
                      ) : (
                        <div className={styles.photoPlaceholder}>
                          <span className={styles.cameraIcon}>📷</span>
                          {i === 0 && (
                            <span className={styles.coverLabel}>
                              Add cover photo
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <p className={styles.photoCount}>
                  {photos.length} of 6 photos uploaded
                </p>
              </div>

              {/* Details & Pricing */}
              <div className={styles.card}>
                <h2 className={styles.cardTitle}>
                  Ad Details, Description &amp; Pricing
                </h2>
                <p className={styles.cardSubtitle}>
                  Complete your ad details, then write a good title &amp;
                  description about the item you want to post.
                </p>
                <p className={styles.cardNote}>
                  Note: Avoid inserting your personal information in this
                  section.
                </p>

                {/* Condition */}
                <div className={styles.fieldGroup}>
                  <h3 className={styles.fieldLabel}>Select item condition</h3>
                  <div className={styles.conditionRow}>
                    {CONDITIONS.map((c) => (
                      <button
                        key={c}
                        className={`${styles.conditionBtn} ${condition === c ? styles.conditionSelected : ""}`}
                        onClick={() => setCondition(c)}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Title */}
                <div className={styles.fieldGroup}>
                  <input
                    className={styles.input}
                    placeholder="Ad Title"
                    maxLength={50}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                  <p className={styles.charCount}>{title.length}/50</p>
                </div>

                {/* Description */}
                <div className={styles.fieldGroup}>
                  <textarea
                    className={styles.textarea}
                    placeholder="Description"
                    maxLength={8000}
                    rows={6}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                  <p className={styles.charCountSmall}>
                    Describe the goods/services accurately by including the
                    price, delivery arrangements, methods of payment, etc., if
                    applicable.
                  </p>
                  <p className={styles.charCount}>{description.length}/8000</p>
                </div>

                {/* Price */}
                <div className={styles.fieldGroup}>
                  <div className={styles.priceInput}>
                    <span className={styles.priceCurrency}>RM</span>
                    <input
                      type="number"
                      className={styles.input}
                      placeholder="Price"
                      min="0"
                      step="0.01"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                    />
                  </div>
                </div>

                {/* Stock */}
                <div className={styles.fieldGroup}>
                  <input
                    type="number"
                    className={styles.input}
                    placeholder="Stock quantity"
                    min="1"
                    step="1"
                    value={stockQuantity}
                    onChange={(e) => setStockQuantity(e.target.value.replace(/[^\d]/g, ""))}
                  />
                  <p className={styles.charCountSmall}>
                    Use 1 for a single second-hand item, or more if you have
                    identical units available.
                  </p>
                </div>

                {/* Location */}
                <div className={styles.fieldGroup}>
                  <div className={styles.locationInput}>
                    <input
                      className={styles.input}
                      placeholder="Location"
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                    />
                    <span className={styles.searchIcon}>🔍</span>
                  </div>
                </div>

                {/* Racket specs (shown only for Rackets category) */}
                {category === "Rackets" && (
                  <div className={styles.fieldGroup}>
                    <h3 className={styles.fieldLabel}>Racket Specifications</h3>
                    <div className={styles.specGrid}>
                      <div>
                        <label className={styles.specLabel}>Weight</label>
                        <select
                          className={styles.select}
                          value={weightCategory}
                          onChange={(e) => setWeightCategory(e.target.value)}
                        >
                          {WEIGHT_CATEGORIES.map((w) => (
                            <option key={w}>{w}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className={styles.specLabel}>Flexibility</label>
                        <select
                          className={styles.select}
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
                        <label className={styles.specLabel}>Balance</label>
                        <select
                          className={styles.select}
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
                <div className={styles.fieldGroup}>
                  <div className={styles.dealingHeader}>
                    <h3 className={styles.fieldLabel}>
                      What is your dealing method?
                    </h3>
                    <button
                      className={styles.selectAllBtn}
                      onClick={() => setDealingMethods([...DEALING_METHODS])}
                    >
                      Select All
                    </button>
                  </div>
                  <div className={styles.dealingRow}>
                    {DEALING_METHODS.map((m) => (
                      <button
                        key={m}
                        className={`${styles.dealingBtn} ${dealingMethods.includes(m) ? styles.dealingSelected : ""}`}
                        onClick={() => toggleDealingMethod(m)}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Contact */}
              <div className={styles.card}>
                <h2 className={styles.cardTitle}>Contact</h2>
                <div className={styles.fieldGroup}>
                  <input
                    className={styles.input}
                    placeholder="Phone Number"
                    maxLength={15}
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                  />
                  <p className={styles.charCountSmall}>
                    Enter your phone number (e.g. 01212345678)
                  </p>
                  <p className={styles.charCount}>{phoneNumber.length}/15</p>
                </div>
              </div>

              {/* Acknowledgement */}
              <div className={styles.card}>
                <h2 className={styles.cardTitle}>Acknowledgement</h2>
                <p className={styles.ackText}>
                  This platform does not allow counterfeit goods to be sold
                  through the site.
                </p>
                <label className={styles.ackRow}>
                  <span className={styles.ackLabel}>
                    I hereby confirm that the goods I&apos;m selling are
                    original and not counterfeit.
                  </span>
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    onChange={(e) => setAcknowledged(e.target.checked)}
                    className={styles.ackCheckbox}
                  />
                </label>
              </div>

              {/* Submit buttons */}
              <div className={styles.submitArea}>
                <button className={styles.previewBtn} disabled={submitting}>
                  PREVIEW AD
                </button>
                <button
                  className={styles.submitBtn}
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
              <p className={styles.disclaimer}>
                By submitting the ad, I confirm that I have read and agreed to
                the Rules of Advertising, Terms &amp; Conditions of this
                platform.
              </p>
            </>
          )}

          {/* ── STEP 3: Success ── */}
          {step === 3 && (
            <div className={styles.card}>
              <div className={styles.successContent}>
                <div className={styles.successIcon}>🎉</div>
                <h2 className={styles.successTitle}>
                  Ad Successfully Submitted!
                </h2>
                <p className={styles.successSubtitle}>
                  Your ad has been posted and will be visible to buyers shortly.
                </p>
                <div className={styles.successActions}>
                  <button
                    className={styles.continueBtn}
                    onClick={() => router.push("/profile/my-ads")}
                  >
                    VIEW MY ADS
                  </button>
                  <button
                    className={styles.previewBtn}
                    onClick={handleClearAll}
                  >
                    POST ANOTHER AD
                  </button>
                </div>
              </div>
            </div>
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

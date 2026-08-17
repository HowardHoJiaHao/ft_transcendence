"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Header from "@/components/Header/Header";
import ShopTabs from "@/components/ShopTabs/ShopTabs";
import ShopHeader from "@/components/ShopTabs/ShopHeader";
import ListingImage from "@/components/ListingImage/ListingImage";
import { PLACEHOLDER_LISTING_IMAGE } from "@/lib/listingImage";
import BulkImport from "@/components/BulkImport/BulkImport";
import { useShopCounts } from "@/components/ShopTabs/useShopCounts";
import { useAuth } from '@/context/AuthContext';
import { useToast } from "@/components/Toast/ToastContext";
import { useI18n } from '@/context/LanguageContext';
import {
  formatFileSize,
  listingFileKind,
  type ListingFile,
  uploadListingFiles,
  validateListingFiles,
} from "@/lib/listingFiles";

// Shared with the bulk importer so its "accepted values" help stays in sync.
import {
  CATEGORIES,
  CONDITIONS,
  DEALING_METHODS,
  WEIGHT_CATEGORIES,
  FLEXIBILITY_CATEGORIES,
  BALANCE_CATEGORIES,
  LISTING_LIMITS,
} from "@/lib/productOptions";

type Condition = (typeof CONDITIONS)[number]; // treat conditions like this is enum, but string union type

// Account-owned values: same field shape as the editable inputs, muted and inert.
const READONLY_FIELD =
  "w-full border border-[#e5e5e3] rounded-md px-3.5 py-3 text-[15px] text-[#555] bg-[#f7f7f5] box-border outline-none cursor-not-allowed";

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
  const documentInputRef = useRef<HTMLInputElement>(null);

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
  const [documents, setDocuments] = useState<File[]>([]);
  const [documentPreviewUrls, setDocumentPreviewUrls] = useState<string[]>([]);
  const [existingFiles, setExistingFiles] = useState<ListingFile[]>([]);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadedFileCount, setUploadedFileCount] = useState(0);
  const [editSaved, setEditSaved] = useState(false);
  // Id of the listing just created, so the success screen can link to it.
  const [postedListingId, setPostedListingId] = useState<number | null>(null);
  const [deletingFileId, setDeletingFileId] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // what information does the form remember?
  // Details & Pricing
  // form state
  const [condition, setCondition] = useState<Condition>("Second-hand (Used)");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [originalPrice, setOriginalPrice] = useState("");
  const [stockQuantity, setStockQuantity] = useState("1");
  // A listing whose photo predates listing_files keeps it on listings.image
  // with no file row. Held here so the seller can still see what is published.
  const [legacyImage, setLegacyImage] = useState("");
  // The listing's current status, preserved across an edit.
  const [loadedStatus, setLoadedStatus] = useState("");
  const [dealingMethods, setDealingMethods] = useState<string[]>([]);
  // Both are the account's, shown read-only: a listing inherits them.
  // Mirrors sellerProfile.incomplete() in the backend, so the form blocks on
  // exactly what the server would reject.
  const sellerStreet = user?.address?.trim() ?? "";
  const sellerPostcode = user?.postcode?.trim() ?? "";
  const sellerState = user?.state?.trim() ?? "";
  const sellerDistrict = user?.district?.trim() ?? "";
  const sellerPhone = user?.phoneNo?.trim() ?? "";
  const addressComplete = Boolean(sellerStreet && sellerPostcode && sellerState && sellerDistrict);
  const profileComplete = addressComplete && Boolean(sellerPhone);
  const [weightCategory, setWeightCategory] = useState("4U");
  const [flexibilityCategory, setFlexibilityCategory] = useState("Medium Flex");
  const [balanceCategory, setBalanceCategory] = useState("Even Balance");
  // Acknowledgement
  const [acknowledged, setAcknowledged] = useState(false);
  /* this block is temporary page state */

  /* ── Unsaved-changes guard (edit mode) ──
     baseline is a snapshot of the listing as it was loaded; comparing the live
     form against it is what makes "are there changes?" answerable. pendingHref
     holds the destination of a navigation that was intercepted and is waiting
     on the seller's answer. */
  const [baseline, setBaseline] = useState<string | null>(null);
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  // The fields the discard guard compares. Dealing methods are order-insensitive
  // — reordering the checkboxes is not an edit — so they are sorted first.
  // Photos are not here: they are Files, and are checked by count instead.
  const formSnapshot = (v: {
    category: string;
    condition: string;
    title: string;
    description: string;
    price: string;
    originalPrice: string;
    stockQuantity: string;
    dealingMethods: string[];
    weightCategory: string;
    flexibilityCategory: string;
    balanceCategory: string;
  }) => JSON.stringify({ ...v, dealingMethods: [...v.dealingMethods].sort() });

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
        // Map once into locals, then use them for both the form and the
        // baseline — deriving the baseline from state instead would race the
        // setters and record an empty form as "the original".
        const loaded = {
          category: p.category || "Others",
          condition: (CONDITIONS.includes(p.condition)
            ? p.condition
            : "Second-hand (Used)") as Condition,
          title: p.title || "",
          description: p.description || "",
          price: p.price?.toString() || "",
          originalPrice: p.originalPrice != null ? p.originalPrice.toString() : "",
          stockQuantity: (p.stockQuantity ?? 1).toString(),
          dealingMethods: p.dealingMethod
            ? p.dealingMethod.split(", ").filter(Boolean)
            : [],
          weightCategory: p.weightCategory || "4U",
          flexibilityCategory: p.flexibilityCategory || "Medium Flex",
          balanceCategory: p.balanceCategory || "Even Balance",
        };
        setCategory(loaded.category);
        setCondition(loaded.condition);
        setTitle(loaded.title);
        setDescription(loaded.description);
        setPrice(loaded.price);
        setOriginalPrice(loaded.originalPrice);
        setStockQuantity(loaded.stockQuantity);
        setLegacyImage(typeof p.image === "string" ? p.image : "");
        setLoadedStatus(typeof p.status === "string" ? p.status : "active");
        setDealingMethods(loaded.dealingMethods);
        setWeightCategory(loaded.weightCategory);
        setFlexibilityCategory(loaded.flexibilityCategory);
        setBalanceCategory(loaded.balanceCategory);
        setBaseline(formSnapshot(loaded));
      })
      .catch(() => showToast(t("sell.loadFailed"), "error"))
      .finally(() => setEditLoading(false));
  }, [editId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!editId) return;
    fetch(`/api/v1/products/${editId}/files`)
      .then(async (response) => {
        if (!response.ok) throw new Error("failed to load files");
        return response.json();
      })
      .then((data) => setExistingFiles(Array.isArray(data.files) ? data.files : []))
      .catch(() => showToast(t("listingFiles.loadFailed"), "error"));
  }, [editId]); // eslint-disable-line react-hooks/exhaustive-deps
/* this is about when user trying to edit the existing listing, call api, fetch data from postgreSQL to make amendment */

  // Unsaved edits exist once the live form diverges from what was loaded, or
  // once a photo has been picked (edit mode always starts with none staged).
  const isDirty =
    isEditMode &&
    baseline !== null &&
    !submitting &&
    (photos.length > 0 ||
      formSnapshot({
        category,
        condition,
        title,
        description,
        price,
        originalPrice,
        stockQuantity,
        dealingMethods,
        weightCategory,
        flexibilityCategory,
        balanceCategory,
      }) !== baseline);

  // Hold navigation while edits are unsaved.
  //
  // The App Router has no navigation-event hook to cancel from, so in-app moves
  // are caught at the click instead: every internal link is intercepted here
  // and re-issued from the dialog if the seller confirms. beforeunload covers
  // what that cannot — reloads, tab closes and off-site links — where the
  // browser shows its own generic prompt.
  useEffect(() => {
    if (!isDirty) return;

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };

    const onClickCapture = (e: MouseEvent) => {
      // Leave modified clicks alone: they open a new tab, so this form stays put.
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as HTMLElement | null)?.closest?.("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      if (anchor.target && anchor.target !== "_self") return;
      // Same-page anchors and the current URL are not really leaving.
      if (href === window.location.pathname + window.location.search) return;
      e.preventDefault();
      e.stopPropagation();
      setPendingHref(href);
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClickCapture, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClickCapture, true);
    };
  }, [isDirty]);

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
    documentPreviewUrls.forEach((u) => URL.revokeObjectURL(u));
    setDocuments([]);
    setDocumentPreviewUrls([]);
    setCondition("Second-hand (Used)");
    setTitle("");
    setDescription("");
    setPrice("");
    setStockQuantity("1");
    setDealingMethods([]);
    setAcknowledged(false);
    setWeightCategory("4U");
    setFlexibilityCategory("Medium Flex");
    setBalanceCategory("Even Balance");
    setUploadProgress(null);
    setUploadedFileCount(0);
    setEditSaved(false);
    setPostedListingId(null);
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
  const existingImages = existingFiles.filter((file) => file.kind === "image");
  // Most listings predate listing_files and carry their photo only on
  // listings.image, so the edit form showed an empty photo grid for them.
  // Surfaced read-only: there is no file record behind it to delete.
  const showLegacyImage = isEditMode && existingImages.length === 0 && legacyImage !== "";
  const existingDocuments = existingFiles.filter((file) => file.kind === "document");

  const showValidationErrors = (errors: string[]) => {
    errors.forEach((error) => showToast(error, "error"));
  };

  const addPhotos = (files: File[]) => {
    const candidates = files.filter((file) => listingFileKind(file) === "image");
    if (candidates.length !== files.length) {
      showToast(t("listingFiles.imagesOnly"), "error");
    }
    const result = validateListingFiles(candidates, {
      images: existingImages.length + photos.length,
      documents: existingDocuments.length + documents.length,
    });
    showValidationErrors(result.errors);
    if (!result.accepted.length) return;
    setPhotos((prev) => [...prev, ...result.accepted]);
    setPhotoPreviewUrls((prev) => [
      ...prev,
      ...result.accepted.map((f) => URL.createObjectURL(f)),
    ]);
  };

  const removePhoto = (i: number) => {
    URL.revokeObjectURL(photoPreviewUrls[i]);
    setPhotos((prev) => prev.filter((_, j) => j !== i));
    setPhotoPreviewUrls((prev) => prev.filter((_, j) => j !== i));
  };

  const addDocuments = (files: File[]) => {
    const candidates = files.filter((file) => listingFileKind(file) === "document");
    if (candidates.length !== files.length) {
      showToast(t("listingFiles.pdfOnly"), "error");
    }
    const result = validateListingFiles(candidates, {
      images: existingImages.length + photos.length,
      documents: existingDocuments.length + documents.length,
    });
    showValidationErrors(result.errors);
    if (!result.accepted.length) return;
    setDocuments((prev) => [...prev, ...result.accepted]);
    setDocumentPreviewUrls((prev) => [
      ...prev,
      ...result.accepted.map((file) => URL.createObjectURL(file)),
    ]);
  };

  const removeDocument = (index: number) => {
    URL.revokeObjectURL(documentPreviewUrls[index]);
    setDocuments((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
    setDocumentPreviewUrls((prev) =>
      prev.filter((_, itemIndex) => itemIndex !== index),
    );
  };

  const deleteExistingFile = async (file: ListingFile) => {
    if (!editId || !window.confirm(t("listingFiles.deleteConfirm", { name: file.originalName }))) {
      return;
    }
    const token = localStorage.getItem("token") || "";
    setDeletingFileId(file.id);
    try {
      const response = await fetch(
        `/api/v1/products/${editId}/files/${file.id}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || t("listingFiles.deleteFailed"));
      }
      setExistingFiles((prev) => prev.filter((item) => item.id !== file.id));
      showToast(t("listingFiles.deleted"), "success");
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : t("listingFiles.deleteFailed"),
        "error",
      );
    } finally {
      setDeletingFileId(null);
    }
  };

  // meet up vs mailing or dealing
  const toggleDealingMethod = (m: string) =>
    setDealingMethods((prev) =>
      prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m],
    );

	//upload to go backend
  const uploadPendingFiles = async (listingId: number, token: string) => {
    const pendingFiles = [...photos, ...documents];
    if (!pendingFiles.length) return 0;
    setUploadProgress(0);
    // Yield one frame so the initial, truthful 0% state is painted before a
    // fast local upload completes.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const uploaded = await uploadListingFiles(
      listingId,
      pendingFiles,
      token,
      setUploadProgress,
    );
    setUploadedFileCount(uploaded.length);
    return uploaded.length;
  };

  const handleSubmit = async () => {
    
	/* validation */
	if (!user) {
      showToast(t("sell.loginFirst"), "error");
      router.push("/login");
      return;
    }
    if (!title.trim()) {
      showToast(t("sell.titleRequired"), "error");
      return;
    }
    if (title.trim().length > LISTING_LIMITS.title) {
      showToast(t("sell.titleTooLong", { max: LISTING_LIMITS.title }), "error");
      return;
    }
    const maxPriceLabel = LISTING_LIMITS.price.toLocaleString();
    if (description.length > LISTING_LIMITS.description) {
      showToast(t("sell.descriptionTooLong", { max: LISTING_LIMITS.description }), "error");
      return;
    }
    const parsedPrice = parseFloat(price);
    if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
      showToast(t("sell.priceInvalid", { max: maxPriceLabel }), "error");
      return;
    }
    if (parsedPrice > LISTING_LIMITS.price) {
      showToast(t("sell.priceTooHigh", { max: maxPriceLabel }), "error");
      return;
    }
    // Optional. Empty means "no discount", which the backend stores as NULL.
    const parsedOriginalPrice = originalPrice.trim()
      ? Number.parseFloat(originalPrice)
      : null;
    if (parsedOriginalPrice !== null && (!Number.isFinite(parsedOriginalPrice) || parsedOriginalPrice <= 0)) {
      showToast(t("sell.originalPriceInvalid", { max: maxPriceLabel }), "error");
      return;
    }
    if (parsedOriginalPrice !== null && parsedOriginalPrice > LISTING_LIMITS.price) {
      showToast(t("sell.priceTooHigh", { max: maxPriceLabel }), "error");
      return;
    }
    const parsedStockQuantity = Number.parseInt(stockQuantity, 10);
    if (!Number.isInteger(parsedStockQuantity) || parsedStockQuantity < 1) {
      showToast(t("sell.stockInvalid", { max: LISTING_LIMITS.stock }), "error");
      return;
    }
    if (parsedStockQuantity > LISTING_LIMITS.stock) {
      showToast(t("sell.stockTooHigh", { max: LISTING_LIMITS.stock }), "error");
      return;
    }
    if (!dealingMethods.length) {
      showToast(t("sell.dealingMethodRequired"), "error");
      return;
    }
    // Location and phone come from the account, so an incomplete profile has
    // nothing to stamp on the listing. Say so here rather than letting the
    // submit fail with a server error.
    if (!profileComplete) {
      showToast(t("sell.profileIncomplete"), "error");
      return;
    }
    // A listing with no photo shows a placeholder everywhere it appears, which
    // buyers skip past. Require one rather than letting it go live blank.
    if (existingImages.length + photos.length + (showLegacyImage ? 1 : 0) === 0) {
      showToast(t("sell.photoRequired"), "error");
      return;
    }
    if (!acknowledged) {
      showToast(t("sell.acknowledgeRequired"), "error");
      return;
    }
	/* validation */

	//authentication setup
    setSubmitting(true);
    const token = localStorage.getItem("token") || "";
    if (!token) {
      setSubmitting(false);
      showToast(t("sell.loginAgain"), "error");
      router.push("/login");
      return;
    }

	//edit existing listing
    try {
      setEditSaved(false);
      setUploadedFileCount(0);
      if (isEditMode) {
        /* ── UPDATE ── */
        const res = await fetch(
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
              title: title.trim(),
              description: description.trim(),
              price: parsedPrice,
              originalPrice: parsedOriginalPrice,
              stockQuantity: parsedStockQuantity,
              weightCategory,
              flexibilityCategory,
              balanceCategory,
              // Keep whatever the listing already is. This was hardcoded to
              // "active", so editing a sold or archived listing silently put
              // it back on sale.
              status: loadedStatus || "active",
            }),
          },
        );
        if (!res.ok) {
          const e = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(e.error || t("sell.updateFailed"));
        }
        await uploadPendingFiles(Number(editId), token);
        showToast(t("sell.updated"), "success");
        setEditSaved(true);
      } else {
        /* ── CREATE new listing ── */
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
            title: title.trim(),
            description: description.trim(),
            price: parsedPrice,
            originalPrice: parsedOriginalPrice,
            stockQuantity: parsedStockQuantity,
            weightCategory,
            flexibilityCategory,
            balanceCategory,
            isNew: condition === "New",
            isFeatured: false,
          }),
        });
        if (!res.ok) {
          const e = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(e.error || t("sell.createFailed"));
        }
        const created = await res.json();
        await uploadPendingFiles(created.id, token);
        showToast(t('toast.listingCreated'), 'success');
        setPostedListingId(Number(created.id) || null);
        setStep(3);
      }
    } catch (err) {
      setUploadProgress(null);
      showToast(
        err instanceof Error ? err.message : t("sell.genericError"),
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
        <div className="p-12 text-center text-[#666] text-base">{t("sell.loadingListing")}</div>
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
            <h2 className="text-lg font-bold m-0 text-[#222]">{t("sell.heading")}</h2>
            <p className="text-xs text-[#888] mt-1 mx-0 mb-3">{t("sell.tagline")}</p>

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
                <span>{t("sell.stepBasic")}</span>
              </li>
              <li
                className={`flex items-center gap-2.5 text-sm ${step > 2 ? "text-[#22c55e] font-semibold [&>span:first-child]:bg-[#22c55e] [&>span:first-child]:text-white" : step === 2 ? "text-[#222] font-semibold [&>span:first-child]:bg-[#222] [&>span:first-child]:text-white" : "text-[#aaa] font-medium [&>span:first-child]:bg-[#e0e0e0] [&>span:first-child]:text-[#888]"}`}
              >
                <span className="w-7 h-7 rounded-full flex items-center justify-center text-[13px] font-bold shrink-0 transition-[background-color,color] duration-300">2</span>
                <span>{t("sell.stepDetails")}</span>
              </li>
              {step === 2 && (
                <ul className="list-none mt-1 mx-0 mb-0 pt-0 pr-0 pb-0 pl-[38px] flex flex-col gap-2">
                  <li className="text-[13px] text-[#555]">{t("sell.stepPhotos")}</li>
                  <li className="text-[13px] text-[#555]">{t("sell.stepPricing")}</li>
                  <li className="text-[13px] text-[#555]">{t("sell.stepContact")}</li>
                  <li className="text-[13px] text-[#555]">{t("sell.stepAcknowledgment")}</li>
                </ul>
              )}
              <li
                className={`flex items-center gap-2.5 text-sm ${step === 3 ? "text-[#22c55e] font-semibold [&>span:first-child]:bg-[#22c55e] [&>span:first-child]:text-white" : "text-[#aaa] font-medium [&>span:first-child]:bg-[#e0e0e0] [&>span:first-child]:text-[#888]"}`}
              >
                <span className="w-7 h-7 rounded-full flex items-center justify-center text-[13px] font-bold shrink-0 transition-[background-color,color] duration-300">{step === 3 ? "✓" : "3"}</span>
                <span>{t("sell.stepSubmitted")}</span>
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
                {t("sell.back")}
              </button>
            )}
            {step !== 3 && (
              <button className="bg-none border-none text-[#22c55e] font-bold cursor-pointer text-sm p-0 ml-auto tracking-[0.3px] hover:underline" onClick={handleClearAll}>
                {t("sell.clearAll")}
              </button>
            )}
          </div>

          {/* ── STEP 1: Category ── */}
          {step === 1 && (
            <div className="bg-white rounded-lg p-6 shadow-[0_1px_3px_rgba(0,0,0,0.1)]">
              <h2 className="text-xl font-bold mt-0 mx-0 mb-2 text-[#222]">{t("sell.categoryTitle")}</h2>
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
                      showToast(t("sell.categoryRequired"), "error");
                      return;
                    }
                    setStep(2);
                  }}
                >
                  {t("sell.continue")}
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 2: Ad Details ── */}
          {step === 2 && (
            <>
              {/* Photos */}
              <div className="bg-white rounded-lg p-6 shadow-[0_1px_3px_rgba(0,0,0,0.1)]">
                <h2 className="text-xl font-bold mt-0 mx-0 mb-2 text-[#222]">{t("sell.photosTitle")}</h2>
                <p className="text-sm text-[#22c55e] mt-0 mx-0 mb-1">
                  {t("sell.photosHint")}
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
                  {t("sell.dropFiles")}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  style={{ display: "none" }}
                  onChange={(e) => {
                    addPhotos(Array.from(e.target.files || []));
                    e.target.value = "";
                  }}
                />

                <div className="grid grid-cols-5 gap-2 mb-2 max-[860px]:grid-cols-3">
                  {existingImages.map((file) => (
                    <div
                      key={`existing-${file.id}`}
                      className="aspect-square border border-[#ddd] rounded-md overflow-hidden bg-[#f9f9f9] relative"
                    >
					  <ListingImage
                        className="w-full h-full object-cover block"
                        src={file.contentUrl}
                        alt={file.originalName}
                      />
                      <button
                        type="button"
                        disabled={deletingFileId === file.id}
                        aria-label={t("listingFiles.deleteNamed", { name: file.originalName })}
                        className="absolute top-[3px] right-[3px] w-5 h-5 rounded-full bg-black/55 text-white border-none cursor-pointer text-base flex items-center justify-center leading-none p-0 disabled:opacity-50"
                        onClick={() => void deleteExistingFile(file)}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  {showLegacyImage && (
                    <div className="aspect-square border border-[#ddd] rounded-md overflow-hidden bg-[#f9f9f9] relative">
                      <ListingImage
                        className="w-full h-full object-cover block"
                        src={legacyImage}
                        alt={t("sell.currentPhotoAlt")}
                      />
                      <span className="absolute bottom-0 inset-x-0 bg-black/55 text-white text-[10px] text-center py-0.5">
                        {t("sell.currentPhoto")}
                      </span>
                    </div>
                  )}
                  {photoPreviewUrls.map((previewUrl, i) => (
                    <div
                      key={previewUrl}
                      className="aspect-square border border-[#ddd] rounded-md overflow-hidden bg-[#f9f9f9] relative"
                    >
                      <img
                        className="w-full h-full object-cover block"
                        src={previewUrl}
                        alt={photos[i]?.name || t("sell.photoAlt", { index: i + 1 })}
						onError={(event) => { event.currentTarget.src = PLACEHOLDER_LISTING_IMAGE; }}
                      />
                      <button
                        type="button"
                        aria-label={t("listingFiles.removeNamed", { name: photos[i]?.name || "" })}
                        className="absolute top-[3px] right-[3px] w-5 h-5 rounded-full bg-black/55 text-white border-none cursor-pointer text-base flex items-center justify-center leading-none p-0"
                        onClick={() => removePhoto(i)}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  {Array.from({
                    length: Math.max(0, 6 - existingImages.length - photos.length - (showLegacyImage ? 1 : 0)),
                  }).map((_, index) => (
                    <button
                      type="button"
                      key={`empty-${index}`}
                      className="aspect-square border border-[#ddd] rounded-md overflow-hidden cursor-pointer bg-[#f9f9f9] relative transition-[border-color] duration-150 hover:border-[#aaa]"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <div className="w-full h-full flex flex-col items-center justify-center gap-1">
                        <span className="text-[22px] opacity-50">📷</span>
                        {existingImages.length + photos.length === 0 && index === 0 && (
                          <span className="text-[10px] text-[#aaa] text-center px-1">
                            {t("sell.addCoverPhoto")}
                          </span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
                <p className="text-right text-xs text-[#888] m-0">
                  {t("sell.photoCount", { count: existingImages.length + photos.length })}
                </p>
              </div>

              {/* Optional PDF attachments */}
              <div className="bg-white rounded-lg p-6 shadow-[0_1px_3px_rgba(0,0,0,0.1)]">
                <h2 className="text-xl font-bold mt-0 mx-0 mb-2 text-[#222]">
                  {t("listingFiles.documentsTitle")}
                </h2>
                <p className="text-sm text-[#555] mt-0 mx-0 mb-4">
                  {t("listingFiles.documentsHint")}
                </p>
                <button
                  type="button"
                  className="border-2 border-dashed border-[#ccc] rounded-lg px-5 py-4 bg-white text-[#555] text-sm cursor-pointer hover:border-[#2563eb] hover:bg-[#f0f7ff]"
                  onClick={() => documentInputRef.current?.click()}
                >
                  📄 {t("listingFiles.choosePdf")}
                </button>
                <input
                  ref={documentInputRef}
                  type="file"
                  accept="application/pdf,.pdf"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    addDocuments(Array.from(event.target.files || []));
                    event.target.value = "";
                  }}
                />

                <div className="mt-4 flex flex-col gap-2">
                  {existingDocuments.map((file) => (
                    <div
                      key={`existing-document-${file.id}`}
                      className="flex items-center gap-3 border border-[#ddd] rounded-lg px-4 py-3 bg-[#f8fafc]"
                    >
                      <span className="text-2xl">📄</span>
                      <div className="min-w-0 flex-1">
                        <p className="m-0 font-semibold text-sm text-[#222] truncate">{file.originalName}</p>
                        <p className="m-0 mt-0.5 text-xs text-[#888]">{formatFileSize(file.size)}</p>
                      </div>
                      <a
                        href={file.contentUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm font-semibold text-[#2563eb]"
                      >
                        {t("listingFiles.preview")}
                      </a>
                      <button
                        type="button"
                        disabled={deletingFileId === file.id}
                        className="border-0 bg-transparent text-sm font-semibold text-red-600 cursor-pointer disabled:opacity-50"
                        onClick={() => void deleteExistingFile(file)}
                      >
                        {t("listingFiles.delete")}
                      </button>
                    </div>
                  ))}
                  {documents.map((file, index) => (
                    <div
                      key={documentPreviewUrls[index]}
                      className="flex items-center gap-3 border border-[#bfdbfe] rounded-lg px-4 py-3 bg-[#eff6ff]"
                    >
                      <span className="text-2xl">📄</span>
                      <div className="min-w-0 flex-1">
                        <p className="m-0 font-semibold text-sm text-[#222] truncate">{file.name}</p>
                        <p className="m-0 mt-0.5 text-xs text-[#888]">
                          {formatFileSize(file.size)} · {t("listingFiles.ready")}
                        </p>
                      </div>
                      <a
                        href={documentPreviewUrls[index]}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm font-semibold text-[#2563eb]"
                      >
                        {t("listingFiles.preview")}
                      </a>
                      <button
                        type="button"
                        className="border-0 bg-transparent text-sm font-semibold text-red-600 cursor-pointer"
                        onClick={() => removeDocument(index)}
                      >
                        {t("listingFiles.remove")}
                      </button>
                    </div>
                  ))}
                </div>
                <p className="text-right text-xs text-[#888] mt-3 mb-0">
                  {t("sell.documentCount", { count: existingDocuments.length + documents.length })}
                </p>
              </div>

              {/* Details & Pricing */}
              <div className="bg-white rounded-lg p-6 shadow-[0_1px_3px_rgba(0,0,0,0.1)]">
                <h2 className="text-xl font-bold mt-0 mx-0 mb-2 text-[#222]">
                  {t("sell.detailsTitle")}
                </h2>
                <p className="text-sm text-[#22c55e] mt-0 mx-0 mb-1">
                  {t("sell.detailsHint")}
                </p>
                <p className="text-[13px] text-[#f59e0b] mt-0 mx-0 mb-5">
                  {t("sell.detailsWarning")}
                </p>

                {/* Condition */}
                <div className="mb-5">
                  <h3 className="text-[15px] font-semibold mt-0 mx-0 mb-2.5 text-[#222]">{t("sell.conditionTitle")}</h3>
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
                    placeholder={t("sell.titlePlaceholder")}
                    maxLength={LISTING_LIMITS.title}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                  <p className="text-right text-xs text-[#888] mt-1 mx-0 mb-0">{title.length}/{LISTING_LIMITS.title}</p>
                </div>

                {/* Description */}
                <div className="mb-5">
                  <textarea
                    className="w-full border border-[#ccc] rounded-md px-3.5 py-3 text-[15px] text-[#333] bg-white resize-y min-h-[140px] box-border outline-none transition-[border-color] duration-150 font-[inherit] focus:border-[#2563eb]"
                    placeholder={t("sell.descriptionPlaceholder")}
                    maxLength={LISTING_LIMITS.description}
                    rows={6}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                  <p className="text-[11px] text-[#aaa] mt-1 mx-0 mb-0 leading-[1.5]">
                    {t("sell.descriptionHint")}
                  </p>
                  <p className="text-right text-xs text-[#888] mt-1 mx-0 mb-0">{description.length}/{LISTING_LIMITS.description}</p>
                </div>

                {/* Price */}
                <div className="mb-5">
                  <div className="flex items-center border border-[#ccc] rounded-md overflow-hidden transition-[border-color] duration-150 focus-within:border-[#2563eb]">
                    <span className="px-3.5 py-3 bg-[#f5f5f5] border-r border-[#ccc] font-semibold text-[#555] text-[15px] shrink-0">RM</span>
                    <input
                      type="number"
                      className="w-full border-none rounded-none flex-1 px-3.5 py-3 text-[15px] text-[#333] bg-white box-border outline-none focus:outline-none focus:shadow-none"
                      placeholder={t("sell.pricePlaceholder")}
                      min="0"
                      max={LISTING_LIMITS.price}
                      step="0.01"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                    />
                  </div>
                </div>

                {/* Original price. The listing carries one and the product page
                    shows it struck through, but the form never loaded or sent
                    it -- so every edit silently cleared it. */}
                <div className="mb-5">
                  <div className="flex items-center border border-[#ccc] rounded-md overflow-hidden transition-[border-color] duration-150 focus-within:border-[#2563eb]">
                    <span className="px-3.5 py-3 bg-[#f5f5f5] border-r border-[#ccc] font-semibold text-[#555] text-[15px] shrink-0">RM</span>
                    <input
                      type="number"
                      className="w-full border-none rounded-none flex-1 px-3.5 py-3 text-[15px] text-[#333] bg-white box-border outline-none focus:outline-none focus:shadow-none"
                      placeholder={t("sell.originalPricePlaceholder")}
                      min="0"
                      max={LISTING_LIMITS.price}
                      step="0.01"
                      value={originalPrice}
                      onChange={(e) => setOriginalPrice(e.target.value)}
                    />
                  </div>
                  <p className="text-[11px] text-[#aaa] mt-1 mx-0 mb-0 leading-[1.5]">
                    {t("sell.originalPriceHint")}
                  </p>
                </div>

                {/* Stock */}
                <div className="mb-5">
                  <input
                    type="number"
                    className="w-full border border-[#ccc] rounded-md px-3.5 py-3 text-[15px] text-[#333] bg-white box-border outline-none transition-[border-color] duration-150 focus:border-[#2563eb]"
                    placeholder={t("sell.stockPlaceholder")}
                    min="1"
                    max={LISTING_LIMITS.stock}
                    step="1"
                    value={stockQuantity}
                    onChange={(e) => setStockQuantity(e.target.value.replace(/[^\d]/g, ""))}
                  />
                  <p className="text-[11px] text-[#aaa] mt-1 mx-0 mb-0 leading-[1.5]">
                    {t("sell.stockHint")}
                  </p>
                </div>

                {/* The profile's delivery address, read-only. It is the whole
                    address rather than just the district so the seller can see
                    exactly what the listing will carry. */}
                <div className="mb-5">
                  <label className="block text-[13px] text-[#666] mb-1">{t("sell.location")}</label>
                  {addressComplete ? (
                    <>
                      {/* Same shape as the profile form, so it reads as the very
                          fields it was copied from — just not editable here. */}
                      <input
                        value={sellerStreet}
                        readOnly
                        disabled
                        aria-label={t("sell.street")}
                        className={READONLY_FIELD}
                      />
                      <div className="grid grid-cols-3 gap-2 mt-2 max-[860px]:grid-cols-1">
                        <input
                          value={sellerPostcode}
                          readOnly
                          disabled
                          aria-label={t("sell.postcode")}
                          className={READONLY_FIELD}
                        />
                        <input
                          value={sellerState}
                          readOnly
                          disabled
                          aria-label={t("sell.state")}
                          className={READONLY_FIELD}
                        />
                        <input
                          value={sellerDistrict}
                          readOnly
                          disabled
                          aria-label={t("sell.district")}
                          className={READONLY_FIELD}
                        />
                      </div>
                      <p className="text-[11px] text-[#aaa] mt-1 mx-0 mb-0 leading-[1.5]">
                        {t("sell.fromAccount")}
                      </p>
                    </>
                  ) : (
                    <div className="w-full border border-[#f0d2c4] rounded-md px-3.5 py-3 text-sm bg-[#fdf6f2] text-[#8a4b2a]">
                      <p className="m-0 mb-2 leading-[1.5]">{t("sell.addressMissing")}</p>
                      <a
                        href="/profile"
                        className="inline-block text-[13px] font-semibold text-[#2563eb] no-underline hover:underline"
                      >
                        {t("sell.setUpInProfile")}
                      </a>
                    </div>
                  )}
                </div>

                {/* Racket specs (shown only for Rackets category) */}
                {category === "Rackets" && (
                  <div className="mb-5">
                    <h3 className="text-[15px] font-semibold mt-0 mx-0 mb-2.5 text-[#222]">{t("sell.racketSpecs")}</h3>
                    <div className="grid grid-cols-3 gap-3 max-[860px]:grid-cols-1">
                      <div>
                        <label className="block text-[13px] text-[#666] mb-1">{t("sell.weight")}</label>
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
                        <label className="block text-[13px] text-[#666] mb-1">{t("sell.flexibility")}</label>
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
                        <label className="block text-[13px] text-[#666] mb-1">{t("sell.balance")}</label>
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
                      {t("sell.dealingMethodTitle")}
                    </h3>
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
                <h2 className="text-xl font-bold mt-0 mx-0 mb-2 text-[#222]">{t("sell.contactTitle")}</h2>
                <div className="mb-5">
                  <label className="block text-[13px] text-[#666] mb-1">{t("sell.phone")}</label>
                  {sellerPhone ? (
                    <>
                      <input
                        value={sellerPhone}
                        readOnly
                        disabled
                        aria-label={t("sell.phone")}
                        className={READONLY_FIELD}
                      />
                      <p className="text-[11px] text-[#aaa] mt-1 mx-0 mb-0 leading-[1.5]">
                        {t("sell.fromAccount")}
                      </p>
                    </>
                  ) : (
                    <div className="w-full border border-[#f0d2c4] rounded-md px-3.5 py-3 text-sm bg-[#fdf6f2] text-[#8a4b2a]">
                      <p className="m-0 mb-2 leading-[1.5]">{t("sell.phoneMissing")}</p>
                      <a
                        href="/profile"
                        className="inline-block text-[13px] font-semibold text-[#2563eb] no-underline hover:underline"
                      >
                        {t("sell.setUpInProfile")}
                      </a>
                    </div>
                  )}
                </div>
              </div>

              {/* Acknowledgement */}
              <div className="bg-white rounded-lg p-6 shadow-[0_1px_3px_rgba(0,0,0,0.1)]">
                <h2 className="text-xl font-bold mt-0 mx-0 mb-2 text-[#222]">{t("sell.acknowledgementTitle")}</h2>
                <p className="text-sm text-[#555] mt-0 mx-0 mb-4">
                  {t("sell.acknowledgementBody")}
                </p>
                <label className="flex items-center justify-between gap-4 cursor-pointer py-3 border-t border-[#eee]">
                  <span className="text-[15px] text-[#22c55e] italic flex-1">
                    {t("sell.acknowledgementCheck")}
                  </span>
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    onChange={(e) => setAcknowledged(e.target.checked)}
                    className="w-5 h-5 cursor-pointer shrink-0"
                  />
                </label>
              </div>

              {uploadProgress !== null && (
                <div
                  className="bg-white rounded-lg p-5 shadow-[0_1px_3px_rgba(0,0,0,0.1)]"
                  role="status"
                  aria-live="polite"
                >
                  <div className="flex justify-between text-sm font-semibold text-[#333] mb-2">
                    <span>
                      {uploadProgress < 100
                        ? t("listingFiles.uploading")
                        : submitting
                          ? t("listingFiles.processing")
                          : t("listingFiles.uploadComplete")}
                    </span>
                    <span>{uploadProgress}%</span>
                  </div>
                  <div className="h-2 bg-[#e5e7eb] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#2563eb] transition-[width] duration-150"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              )}

              {editSaved && (
                <div className="bg-[#ecfdf5] border border-[#86efac] rounded-lg p-5 flex items-center justify-between gap-4 max-[600px]:items-start max-[600px]:flex-col" role="status">
                  <div>
                    <p className="m-0 font-bold text-[#166534]">✓ {t("listingFiles.changesSaved")}</p>
                    <p className="m-0 mt-1 text-sm text-[#166534]">
                      {uploadedFileCount > 0
                        ? t("listingFiles.filesUploaded", { count: uploadedFileCount })
                        : t("listingFiles.noNewFiles")}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="bg-[#166534] text-white border-none rounded-md px-4 py-2 text-sm font-semibold cursor-pointer"
                    onClick={() => router.push(`/products/${editId}`)}
                  >
                    {t("sell.viewListing")}
                  </button>
                </div>
              )}

              {/* Submit buttons */}
              <div className="flex justify-end gap-3">
                <button
                  className="px-7 py-3 bg-[#2563eb] text-white border-none rounded-md text-sm font-bold cursor-pointer tracking-[0.5px] transition-colors duration-150 enabled:hover:bg-[#1d4ed8] disabled:bg-[#93c5fd] disabled:cursor-not-allowed"
                  disabled={submitting}
                  onClick={handleSubmit}
                >
                  {submitting
                    ? t("sell.submitting")
                    : isEditMode
                      ? t("sell.saveChanges")
                      : t("sell.submitNow")}
                </button>
              </div>
              <p className="text-xs text-[#888] text-center leading-[1.6] m-0">
                {t("sell.termsNote")}
              </p>
            </>
          )}

          {/* ── STEP 3: Success ── */}
          {step === 3 && (
            <div className="bg-white rounded-lg p-6 shadow-[0_1px_3px_rgba(0,0,0,0.1)]">
              <div className="flex flex-col items-center px-5 py-12 text-center">
                <div className="text-[64px] mb-4">🎉</div>
                <h2 className="text-[28px] font-bold text-[#222] mt-0 mx-0 mb-2">
                  {t("sell.successTitle")}
                </h2>
                <p className="text-base text-[#666] mt-0 mx-0 mb-8">
                  {t("sell.successBody")}
                </p>
                {uploadedFileCount > 0 && (
                  <div className="w-full max-w-[520px] bg-[#ecfdf5] border border-[#86efac] rounded-lg px-5 py-4 text-left mb-8">
                    <p className="m-0 font-bold text-[#166534]">✓ {t("listingFiles.uploadComplete")}</p>
                    <p className="m-0 mt-1 text-sm text-[#166534]">
                      {t("listingFiles.filesUploaded", { count: uploadedFileCount })}
                    </p>
                  </div>
                )}
                <div className="flex gap-4 flex-wrap justify-center">
                  <button
                    className="bg-[#2563eb] text-white border-none rounded-md px-8 py-3 text-sm font-bold cursor-pointer tracking-[0.5px] transition-colors duration-150 hover:bg-[#1d4ed8] disabled:bg-[#93c5fd] disabled:cursor-not-allowed"
                    onClick={() =>
                      router.push(postedListingId ? `/products/${postedListingId}` : "/profile/my-ads")
                    }
                  >
                    {t("sell.viewListing")}
                  </button>
                  <button
                    className="px-7 py-3 border border-[#555] bg-white rounded-md text-sm font-bold cursor-pointer text-[#333] tracking-[0.5px] transition-colors duration-150 enabled:hover:bg-[#f5f5f5] disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={handleClearAll}
                  >
                    {t("sell.postAnother")}
                  </button>
                </div>
              </div>
            </div>
          )}
          </>
          )}
        </div>
      </div>

      {/* Raised when a navigation was intercepted with edits still unsaved.
          Confirming re-issues the move that was held. */}
      {pendingHref && (
        <div
          className="fixed inset-0 z-[1200] bg-black/40 flex items-center justify-center px-4"
          onClick={() => setPendingHref(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="discard-title"
            className="bg-white border border-[#e8e8e6] rounded-xl shadow-[0_10px_30px_rgba(0,0,0,0.2)] w-full max-w-[420px] px-5 py-[18px]"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="discard-title" className="text-lg font-bold text-[#222] mt-0 mx-0 mb-2">
              {t("sell.discardTitle")}
            </h2>
            <p className="text-[#898781] text-sm mt-0 mx-0 mb-5">
              {t("sell.discardBody")}
            </p>
            <div className="flex gap-2.5 justify-end flex-wrap">
              <button
                type="button"
                className="border border-[#ccc] bg-white rounded-lg px-3.5 py-[7px] text-[13px] font-semibold text-[#333] cursor-pointer transition-[border-color] duration-150 hover:border-[#888]"
                onClick={() => setPendingHref(null)}
              >
                {t("sell.keepEditing")}
              </button>
              <button
                type="button"
                className="inline-flex items-center px-[18px] py-[7px] rounded-lg bg-[#c62828] text-white border-none text-[13px] font-semibold cursor-pointer transition-colors duration-150 hover:bg-[#a91f1f]"
                onClick={() => {
                  const href = pendingHref;
                  setPendingHref(null);
                  router.push(href);
                }}
              >
                {t("sell.discardChanges")}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

/* ─────────────────────────────────────────
   Page export – wraps inner in Suspense
   (required by Next.js for useSearchParams)
───────────────────────────────────────── */
// Its own component so the fallback can read the active language too — the
// provider lives in the root layout, above this Suspense boundary.
function SellPageFallback() {
  const { t } = useI18n();
  return <div style={{ padding: 24 }}>{t("sell.loading")}</div>;
}

export default function SellPage() {
  return (
    <Suspense fallback={<SellPageFallback />}>
      <SellPageInner />
    </Suspense>
  );
}

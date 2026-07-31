'use client';

// My Shop — the seller dashboard page.
// Tabs Published / Pending Orders / Sold / Archived manage the seller's listings;
// the Analytics tab adds revenue stats, a monthly sales chart and per-item tables.
// Every label goes through t() (src/i18n) so the whole page — charts included —
// re-renders in the language picked in the header.

import { Fragment, Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useAuth } from '@/context/AuthContext';;
import { useToast } from '@/components/Toast/ToastContext';
import { useI18n } from '@/context/LanguageContext';
import Header from '@/components/Header/Header';
import ShopTabs, { type ShopListTab } from '@/components/ShopTabs/ShopTabs';
import ShopHeader from '@/components/ShopTabs/ShopHeader';
import { downloadCsv } from '@/lib/csv';

// A seller listing as returned by GET /api/v1/products.
interface Ad {
  id: number;
  title: string;
  price: number;
  image: string;
  location: string;
  status: string;
  viewsCount: number;
  createdAt: string;
}

// A pending order enriched with listing and buyer info (GET /api/v1/seller/orders).
// The backend's EnrichedOrder returns more than the list row shows; the extra
// fields below feed the order details dialog.
interface SellerOrder {
  id: number;
  buyerId: number;
  listingId: number;
  quantity: number;
  totalPrice: number;
  status: string;
  paymentMethod: string;
  createdAt: string;
  updatedAt: string;
  listingTitle: string;
  listingImage: string;
  listingCategory: string;
  listingPrice: number;
  buyerUsername: string;
  buyerEmail: string;
}

// Per-listing analytics row (GET /api/v1/seller/dashboard/items).
interface SellerItemStat {
  listingId: number;
  title: string;
  price: number;
  category: string;
  status: string;
  daysListed: number;
  viewsLast30Days: number;
  sold: boolean;
  soldAt?: string;
  revenue: number;
  stale: boolean;
}

// Revenue/order totals for one "YYYY-MM" month.
interface SellerMonthlyStat {
  month: string;
  orderCount: number;
  revenue: number;
}

// Lifetime sales totals for one category.
interface CategoryStat {
  category: string;
  itemsSold: number;
  revenue: number;
}

// One month × category cell — the raw rows behind the stacked bar chart.
interface MonthlyCategoryStat {
  month: string;
  category: string;
  orderCount: number;
  revenue: number;
}

// Aggregated dashboard stats (GET /api/v1/seller/dashboard/summary).
interface SellerSummary {
  totalRevenue: number;
  pendingOrders: number;
  itemsSold: number;
  itemsActive: number;
  itemsArchived: number;
  sellThroughRate: number;
  avgDaysToSell: number;
  monthlyRevenue: SellerMonthlyStat[];
  monthlyByCategory: MonthlyCategoryStat[];
  categoryBreakdown: CategoryStat[];
}

// Sortable columns of the My Items and Sales by Category tables.
type ItemSortKey = 'title' | 'price' | 'category' | 'status' | 'daysListed' | 'viewsLast30Days' | 'soldAt';
type CategorySortKey = 'category' | 'itemsSold' | 'revenue' | 'avgDays';

// Which measure the sales chart plots.
type ChartMetric = 'revenue' | 'orderCount';

// Categorical palette slots in fixed order (validated for CVD-safe adjacency);
// categories map to slots by stable alphabetical order, never by rank.
const CHART_COLORS = [
  '#2a78d6', '#1baf7a', '#eda100', '#008300',
  '#4a3aa7', '#e34948', '#e87ba4', '#eb6834',
];

const ADS_PER_PAGE = 15;
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || '';
const PLACEHOLDER_IMAGE = 'https://via.placeholder.com/350x450';

const LIST_TABS: ShopListTab[] = ['active', 'pending', 'sold', 'archived', 'analytics'];

function MyAdsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const { showToast } = useToast();
  const { t } = useI18n();

  // "2026-03" → localized "Mar 2026" / "3月 2026"; re-renders with the active language.
  const formatChartMonth = (month: string) =>
    `${t(`months.${month.slice(5, 7)}`)} ${month.slice(0, 4)}`;

  // Open tab; each listing status keeps its own list so switching tabs is instant.
  // ShopTabs on Post an Ad / Developer API links here as ?tab=<id>, so honour
  // that on mount — an unknown or missing value falls back to Published.
  const requestedTab = searchParams.get('tab') as ShopListTab | null;
  const [activeTab, setActiveTab] = useState<ShopListTab>(
    requestedTab && LIST_TABS.includes(requestedTab) ? requestedTab : 'active',
  );
  const [publishedAds, setPublishedAds] = useState<Ad[]>([]);
  const [pendingOrders, setPendingOrders] = useState<SellerOrder[]>([]);
  const [soldAds, setSoldAds] = useState<Ad[]>([]);
  const [archivedAds, setArchivedAds] = useState<Ad[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [completingOrderId, setCompletingOrderId] = useState<number | null>(null);
  const [cancellingOrderId, setCancellingOrderId] = useState<number | null>(null);
  const [page, setPage] = useState(1);

  // Deleting a listing is irreversible, so it is confirmed in a dialog that
  // names the ad rather than a native confirm() the browser can suppress.
  const [pendingDelete, setPendingDelete] = useState<Ad | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Listing currently being archived or republished, so its row can show progress.
  const [statusChangingId, setStatusChangingId] = useState<number | null>(null);
  // Archive/republish both move a listing in or out of the marketplace, so both
  // are confirmed first. Holds the ad and the status it would move to.
  const [pendingStatusChange, setPendingStatusChange] = useState<
    { ad: Ad; status: 'active' | 'archived' } | null
  >(null);
  // The order whose details dialog is open.
  const [orderDetails, setOrderDetails] = useState<SellerOrder | null>(null);

  // Analytics data — fetched lazily the first time the Analytics tab opens;
  // analyticsLoaded doubles as the cache flag (reset after an order completes).
  const [itemStats, setItemStats] = useState<SellerItemStat[]>([]);
  const [summary, setSummary] = useState<SellerSummary | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsLoaded, setAnalyticsLoaded] = useState(false);
  const [itemSort, setItemSort] = useState<{ key: ItemSortKey; dir: 1 | -1 } | null>(null);
  const [catSort, setCatSort] = useState<{ key: CategorySortKey; dir: 1 | -1 } | null>(null);

  // First click on a column header sorts ascending; a second click flips direction.
  const toggleItemSort = (key: ItemSortKey) =>
    setItemSort((s) => (s?.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));
  const toggleCatSort = (key: CategorySortKey) =>
    setCatSort((s) => (s?.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));

  // "▲"/"▼" suffix shown on the actively sorted column header.
  const sortArrow = (active: boolean, dir: 1 | -1) => (active ? (dir === 1 ? ' ▲' : ' ▼') : '');

  // My Items table: pagination plus a collapsible filter panel.
  const ITEMS_PER_PAGE = 15;
  const [itemPage, setItemPage] = useState(1);
  const [showItemFilters, setShowItemFilters] = useState(false);
  const [itemFilters, setItemFilters] = useState({
    search: '',
    priceMin: '', priceMax: '',
    daysMin: '', daysMax: '',
    viewsMin: '', viewsMax: '',
    cats: null as string[] | null,      // null = all categories
    statuses: null as string[] | null,  // null = all statuses
    sold: 'all' as 'all' | 'sold' | 'unsold',
  });

  // Distinct categories among the seller's items — chips in the filter panel.
  const itemCategories = useMemo(
    () => Array.from(new Set(itemStats.map((it) => it.category))).sort(),
    [itemStats],
  );
  const ITEM_STATUSES = ['active', 'pending', 'sold', 'archived'];

  // Toggle one chip of a multi-select filter; null ("all") expands to the full list first.
  const toggleFilterList = (field: 'cats' | 'statuses', value: string, full: string[]) =>
    setItemFilters((f) => {
      const base = f[field] ?? full;
      const next = base.includes(value)
        ? base.filter((v) => v !== value)
        : [...base, value];
      return { ...f, [field]: next };
    });

  // How many filter groups are constraining the table — shown on the Filters button.
  const activeFilterCount =
    (itemFilters.search ? 1 : 0) +
    (itemFilters.priceMin || itemFilters.priceMax ? 1 : 0) +
    (itemFilters.daysMin || itemFilters.daysMax ? 1 : 0) +
    (itemFilters.viewsMin || itemFilters.viewsMax ? 1 : 0) +
    (itemFilters.cats !== null ? 1 : 0) +
    (itemFilters.statuses !== null ? 1 : 0) +
    (itemFilters.sold !== 'all' ? 1 : 0);

  const clearItemFilters = () =>
    setItemFilters({
      search: '', priceMin: '', priceMax: '', daysMin: '', daysMax: '',
      viewsMin: '', viewsMax: '', cats: null, statuses: null, sold: 'all',
    });

  // Numeric range check; blank min/max inputs mean unbounded.
  const inRange = (v: number, min: string, max: string) => {
    const lo = parseFloat(min);
    const hi = parseFloat(max);
    if (!Number.isNaN(lo) && v < lo) return false;
    if (!Number.isNaN(hi) && v > hi) return false;
    return true;
  };

  // Apply search, numeric ranges and chip selections to the item rows.
  const filteredItems = useMemo(
    () =>
      itemStats.filter((it) => {
        if (
          itemFilters.search &&
          !it.title.toLowerCase().includes(itemFilters.search.toLowerCase())
        )
          return false;
        if (!inRange(it.price, itemFilters.priceMin, itemFilters.priceMax)) return false;
        if (!inRange(it.daysListed, itemFilters.daysMin, itemFilters.daysMax)) return false;
        if (!inRange(it.viewsLast30Days, itemFilters.viewsMin, itemFilters.viewsMax))
          return false;
        if (itemFilters.cats !== null && !itemFilters.cats.includes(it.category)) return false;
        if (itemFilters.statuses !== null && !itemFilters.statuses.includes(it.status))
          return false;
        if (itemFilters.sold === 'sold' && !it.sold) return false;
        if (itemFilters.sold === 'unsold' && it.sold) return false;
        return true;
      }),
    [itemStats, itemFilters],
  );

  // Any filter or sort change resets the table to page 1.
  useEffect(() => {
    setItemPage(1);
  }, [itemFilters, itemSort]);

  const sortedItems = useMemo(() => {
    if (!itemSort) return filteredItems;
    const { key, dir } = itemSort;
    return [...filteredItems].sort((a, b) => {
      if (key === 'soldAt') {
        // Unsold items (no date) always sort after sold ones
        if (!a.soldAt && !b.soldAt) return 0;
        if (!a.soldAt) return 1;
        if (!b.soldAt) return -1;
        return a.soldAt.localeCompare(b.soldAt) * dir;
      }
      const av = a[key];
      const bv = b[key];
      if (typeof av === 'string' && typeof bv === 'string') return av.localeCompare(bv) * dir;
      return ((av as number) - (bv as number)) * dir;
    });
  }, [filteredItems, itemSort]);

  // Clamp the page number in case filtering shrank the result set.
  const itemTotalPages = Math.max(1, Math.ceil(sortedItems.length / ITEMS_PER_PAGE));
  const clampedItemPage = Math.min(itemPage, itemTotalPages);
  const pagedItems = sortedItems.slice(
    (clampedItemPage - 1) * ITEMS_PER_PAGE,
    clampedItemPage * ITEMS_PER_PAGE,
  );

  // Sales-by-Category rows: the backend breakdown plus an average days-to-sell
  // derived client-side from each category's sold items.
  const sortedCategories = useMemo(() => {
    const rows = (summary?.categoryBreakdown ?? []).map((cs) => {
      const soldIn = itemStats.filter((it) => it.category === cs.category && it.sold);
      const avgDays = soldIn.length
        ? soldIn.reduce((s, it) => s + it.daysListed, 0) / soldIn.length
        : 0;
      return { ...cs, avgDays };
    });
    if (!catSort) return rows;
    const { key, dir } = catSort;
    return [...rows].sort((a, b) => {
      if (key === 'category') return a.category.localeCompare(b.category) * dir;
      return (a[key] - b[key]) * dir;
    });
  }, [summary, itemStats, catSort]);

  const [chartMetric, setChartMetric] = useState<ChartMetric>('revenue');
  // null = all on; otherwise the explicit ON set
  const [selectedYears, setSelectedYears] = useState<string[] | null>(null);
  const [selectedMonths, setSelectedMonths] = useState<string[] | null>(null);
  const [selectedCats, setSelectedCats] = useState<string[] | null>(null);
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());

  // Shared chip toggler for the chart's year/month filters.
  const toggleInList = (
    setter: (fn: (prev: string[] | null) => string[] | null) => void,
    value: string,
    full: string[],
  ) =>
    setter((prev) => {
      const base = prev ?? full;
      return base.includes(value) ? base.filter((v) => v !== value) : [...base, value];
    });

  // Stable category → color-slot assignment (alphabetical, over the FULL data —
  // filtering must never repaint the surviving categories)
  const chartCategories = useMemo(() => {
    const set = new Set<string>();
    (summary?.monthlyByCategory ?? []).forEach((r) => set.add(r.category));
    return Array.from(set).sort();
  }, [summary]);

  const catColor = (cat: string) =>
    CHART_COLORS[chartCategories.indexOf(cat) % CHART_COLORS.length];

  // Distinct years / month numbers present in the data — these drive the filter chips.
  const chartYears = useMemo(
    () =>
      Array.from(
        new Set((summary?.monthlyByCategory ?? []).map((r) => r.month.slice(0, 4))),
      ).sort(),
    [summary],
  );

  const chartMonthParts = useMemo(
    () =>
      Array.from(
        new Set((summary?.monthlyByCategory ?? []).map((r) => r.month.slice(5, 7))),
      ).sort(),
    [summary],
  );

  // Resolve the null-means-all convention into concrete selections.
  const activeYears = selectedYears ?? chartYears;
  const activeMonths = selectedMonths ?? chartMonthParts;
  const allYearsOn = selectedYears === null || activeYears.length === chartYears.length;
  const allMonthsOn =
    selectedMonths === null || activeMonths.length === chartMonthParts.length;

  const activeCats = selectedCats ?? chartCategories;
  const allCatsOn = selectedCats === null || activeCats.length === chartCategories.length;

  const toggleCat = (cat: string) =>
    setSelectedCats((prev) => {
      const base = prev ?? chartCategories;
      return base.includes(cat) ? base.filter((c) => c !== cat) : [...base, cat];
    });

  const toggleExpandCat = (cat: string) =>
    setExpandedCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });

  // Rows surviving the year/month/category chips; feeds the chart and its CSV export.
  const filteredChartRows = useMemo(
    () =>
      (summary?.monthlyByCategory ?? []).filter(
        (r) =>
          activeYears.includes(r.month.slice(0, 4)) &&
          activeMonths.includes(r.month.slice(5, 7)) &&
          activeCats.includes(r.category),
      ),
    [summary, activeYears, activeMonths, activeCats],
  );

  // Pivot to one row per month ({ month, [category]: value }) — the shape
  // recharts stacked bars expect.
  const chartData = useMemo(() => {
    const byMonth = new Map<string, Record<string, number | string>>();
    filteredChartRows.forEach((r) => {
      if (!byMonth.has(r.month)) byMonth.set(r.month, { month: r.month });
      byMonth.get(r.month)![r.category] = r[chartMetric];
    });
    return Array.from(byMonth.values()).sort((a, b) =>
      String(a.month).localeCompare(String(b.month)),
    );
  }, [filteredChartRows, chartMetric]);

  const visibleCategories = chartCategories.filter((c) => activeCats.includes(c));

  // CSV of every sold item, grouped by category.
  const exportCategoryCsv = () =>
    downloadCsv(
      'seller-category-sales.csv',
      ['category', 'item', 'soldAt', 'daysToSell', 'revenue'],
      itemStats
        .filter((it) => it.sold)
        .sort((a, b) => a.category.localeCompare(b.category))
        .map((it) => [
          it.category, it.title, it.soldAt ?? '', it.daysListed, it.revenue,
        ]),
    );

  // CSV of the chart's currently filtered rows.
  const exportChartCsv = () =>
    downloadCsv(
      'seller-monthly-sales.csv',
      ['month', 'category', 'itemsSold', 'revenue'],
      filteredChartRows.map((r) => [r.month, r.category, r.orderCount, r.revenue]),
    );

  // CSV of the item table in its current sort order (all pages, not just the visible one).
  const exportItemsCsv = () =>
    downloadCsv(
      'seller-items.csv',
      ['item', 'category', 'price', 'status', 'daysListed', 'views30d', 'sold', 'soldAt', 'revenue'],
      sortedItems.map((it) => [
        it.title, it.category, it.price, it.status, it.daysListed,
        it.viewsLast30Days, it.sold ? 'yes' : 'no', it.soldAt ?? '', it.revenue,
      ]),
    );

  // Initial load once auth resolves: the seller's listings per status + pending orders.
  useEffect(() => {
    if (authLoading) {
      return;
    }
    if (!user) {
      router.push('/login');
      return;
    }
    setLoading(true);
    const token = localStorage.getItem('token') || '';
    Promise.all([
      fetch(
        `${API_BASE}/api/v1/products?sellerId=${user.id}&status=active&limit=100`,
      ).then((r) => r.json()),
      fetch(
        `${API_BASE}/api/v1/products?sellerId=${user.id}&status=sold&limit=100`,
      ).then((r) => r.json()),
      fetch(
        `${API_BASE}/api/v1/products?sellerId=${user.id}&status=archived&limit=100`,
      ).then((r) => r.json()),
      fetch(`${API_BASE}/api/v1/seller/orders?status=pending`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => r.json()),
    ])
      .then(([activeData, soldData, archivedData, pendingData]) => {
        setPublishedAds(activeData.products || []);
        setSoldAds(soldData.products || []);
        setArchivedAds(archivedData.products || []);
        setPendingOrders(pendingData.orders || []);
      })
      .catch(() => showToast('Failed to load your ads', 'error'))
      .finally(() => setLoading(false));
  }, [authLoading, user]); // eslint-disable-line react-hooks/exhaustive-deps

  // Lazy-load analytics on the first visit to the tab; skipped afterwards
  // until analyticsLoaded is reset (e.g. after completing an order).
  useEffect(() => {
    if (authLoading || activeTab !== 'analytics' || analyticsLoaded || !user) return;
    const token = localStorage.getItem('token') || '';
    setAnalyticsLoading(true);
    Promise.all([
      fetch(`${API_BASE}/api/v1/seller/dashboard/items`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => {
        if (!r.ok) throw new Error('Failed to load item stats');
        return r.json();
      }),
      fetch(`${API_BASE}/api/v1/seller/dashboard/summary`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => {
        if (!r.ok) throw new Error('Failed to load summary');
        return r.json();
      }),
    ])
      .then(([itemsData, summaryData]) => {
        setItemStats(itemsData.items || []);
        setSummary(summaryData);
        setAnalyticsLoaded(true);
      })
      .catch(() => showToast('Failed to load analytics', 'error'))
      .finally(() => setAnalyticsLoading(false));
  }, [authLoading, activeTab, analyticsLoaded, user]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tallies for the shared header and tab row. This page already holds the
  // real lists, so it never needs useShopCounts.
  const shopCounts = {
    active: publishedAds.length,
    pending: pendingOrders.length,
    sold: soldAds.length,
    archived: archivedAds.length,
  };

  // List + pagination for the currently open listings tab.
  const currentAds =
    activeTab === 'active' ? publishedAds : activeTab === 'sold' ? soldAds : archivedAds;
  const totalPages = Math.max(1, Math.ceil(currentAds.length / ADS_PER_PAGE));
  const paginatedAds = currentAds.slice(
    (page - 1) * ADS_PER_PAGE,
    page * ADS_PER_PAGE,
  );

  // Delete the ad held in pendingDelete and drop it from whichever tab list had
  // it. Only ever reached from the confirmation dialog below.
  const handleDelete = async () => {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    const token = localStorage.getItem('token') || '';
    setDeleting(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/products/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setPublishedAds((prev) => prev.filter((a) => a.id !== id));
        setSoldAds((prev) => prev.filter((a) => a.id !== id));
        setArchivedAds((prev) => prev.filter((a) => a.id !== id));
        showToast('Ad deleted successfully', 'success');
        setPendingDelete(null);
      } else {
        const data = await res.json().catch(() => ({})) as { error?: string };
        showToast(data.error || 'Failed to delete ad', 'error');
      }
    } catch {
      showToast('Network error', 'error');
    } finally {
      setDeleting(false);
    }
  };

  // Move a listing between active and archived.
  //
  // PUT /products/:id replaces the whole listing rather than patching it, and
  // the Ad rows here only carry what the list needs (no description, category,
  // condition, phone or racket specs). So this reads the full product back
  // first and returns it unchanged apart from status — sending an Ad directly
  // would blank every field the list does not happen to show.
  const handleSetStatus = async (ad: Ad, status: 'active' | 'archived') => {
    const token = localStorage.getItem('token') || '';
    setStatusChangingId(ad.id);
    try {
      const currentRes = await fetch(`${API_BASE}/api/v1/products/${ad.id}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!currentRes.ok) throw new Error('Failed to load the listing');
      const current = await currentRes.json();

      const res = await fetch(`${API_BASE}/api/v1/products/${ad.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          category: current.category,
          condition: current.condition,
          dealingMethod: current.dealingMethod,
          phoneNumber: current.phoneNumber,
          title: current.title,
          description: current.description,
          weightCategory: current.weightCategory,
          flexibilityCategory: current.flexibilityCategory,
          balanceCategory: current.balanceCategory,
          price: current.price,
          originalPrice: current.originalPrice,
          location: current.location,
          stockQuantity: current.stockQuantity,
          status,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error || 'Failed to update the listing');
      }
      // The backend downgrades a republish to "sold" when stock is 0, so read
      // the result rather than assuming the status we asked for.
      const updated = await res.json().catch(() => null) as { status?: string } | null;
      await refreshSellerData();
      setPendingStatusChange(null);
      if (status === 'archived') {
        showToast('Ad archived', 'success');
      } else if (updated?.status === 'sold') {
        showToast('Republished as Sold — this listing has no stock left', 'success');
      } else {
        showToast('Ad republished', 'success');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Network error', 'error');
    } finally {
      setStatusChangingId(null);
    }
  };

  // Cancel a pending order, which puts its listing back on sale. Without this
  // a sale that falls through would strand the listing in 'pending' forever.
  const handleCancelOrder = async (orderId: number) => {
    const token = localStorage.getItem('token') || '';
    setCancellingOrderId(orderId);
    try {
      const res = await fetch(`${API_BASE}/api/v1/orders/${orderId}/cancel`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error || 'Failed to cancel order');
      }
      setPendingOrders((prev) => prev.filter((order) => order.id !== orderId));
      setAnalyticsLoaded(false);
      setItemStats([]);
      setSummary(null);
      await refreshSellerData();
      showToast('Order cancelled and listing relisted', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Network error', 'error');
    } finally {
      setCancellingOrderId(null);
    }
  };

  // "12 Mar 2026"-style display date for ad/order rows.
  const formatDate = (str: string) => {
    try {
      return new Date(str).toLocaleDateString('en-MY', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return str;
    }
  };

  // Whole days elapsed since the given timestamp (never negative).
  const daysSince = (str: string) => {
    const d = new Date(str).getTime();
    if (Number.isNaN(d)) return 0;
    return Math.max(0, Math.floor((Date.now() - d) / 86400000));
  };

  // Resolve image paths: absolute/data URLs pass through, relative ones are
  // served by the backend host.
  const imgSrc = (ad: Ad) => {
    if (!ad.image) return PLACEHOLDER_IMAGE;
    if (ad.image.startsWith('http://') || ad.image.startsWith('https://') || ad.image.startsWith('data:'))
      return ad.image;
    if (ad.image.startsWith('/')) return `${API_BASE}${ad.image}`;
    return `${API_BASE}/${ad.image}`;
  };
  const orderImgSrc = (order: SellerOrder) => {
    if (!order.listingImage) return PLACEHOLDER_IMAGE;
    if (order.listingImage.startsWith('http://') || order.listingImage.startsWith('https://') || order.listingImage.startsWith('data:'))
      return order.listingImage;
    if (order.listingImage.startsWith('/')) return `${API_BASE}${order.listingImage}`;
    return `${API_BASE}/${order.listingImage}`;
  };
  // Refetch pending orders (called every time the Pending tab is opened).
  const fetchPendingOrders = async () => {
    const token = localStorage.getItem('token') || '';
    setPendingLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/seller/orders?status=pending`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error || 'Failed to load pending orders');
      }
      const data = await res.json();
      setPendingOrders(data.orders || []);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to load pending orders', 'error');
    } finally {
      setPendingLoading(false);
    }
  };
  // Re-pull all three listing lists so tab counts stay accurate after a sale.
  const refreshSellerData = async () => {
    if (!user) return;
    const [activeData, soldData, archivedData] = await Promise.all([
      fetch(`${API_BASE}/api/v1/products?sellerId=${user.id}&status=active&limit=100`).then((r) => r.json()),
      fetch(`${API_BASE}/api/v1/products?sellerId=${user.id}&status=sold&limit=100`).then((r) => r.json()),
      fetch(`${API_BASE}/api/v1/products?sellerId=${user.id}&status=archived&limit=100`).then((r) => r.json()),
    ]);
    setPublishedAds(activeData.products || []);
    setSoldAds(soldData.products || []);
    setArchivedAds(archivedData.products || []);
  };
  // Mark an order delivered, then invalidate the cached analytics and refresh
  // the listing lists so Sold counts and revenue reflect the completed sale.
  const handleCompleteOrder = async (orderId: number) => {
    const token = localStorage.getItem('token') || '';
    setCompletingOrderId(orderId);
    try {
      const res = await fetch(`${API_BASE}/api/v1/orders/${orderId}/complete`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error || 'Failed to mark order delivered');
      }
      setPendingOrders((prev) => prev.filter((order) => order.id !== orderId));
      setAnalyticsLoaded(false);
      setItemStats([]);
      setSummary(null);
      await refreshSellerData();
      if (activeTab === 'analytics') {
        setActiveTab('analytics');
      }
      showToast('Order marked as delivered', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to mark order delivered', 'error');
    } finally {
      setCompletingOrderId(null);
    }
  };

  return (
    <main className="min-h-screen bg-[#f0f0f0]">
      <Header/>

      <div className="max-w-[1180px] mx-auto pt-7 px-8 pb-16">
        <ShopHeader counts={shopCounts} />

        <div className="bg-white rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.1)] overflow-hidden">
          {/* Tabs — shared with Post an Ad and Developer API so the row never
              disappears; here the listing tabs switch in place. */}
          <ShopTabs
            current={activeTab}
            counts={shopCounts}
            onSelect={(tab) => {
              setActiveTab(tab);
              if (tab !== 'analytics') setPage(1);
              if (tab === 'pending') fetchPendingOrders();
            }}
          />

          {/* Analytics */}
          {activeTab === 'analytics' ? (
            <div className="p-5">
              {analyticsLoading ? (
                <p className="text-[#888] text-[15px] mt-0 mx-0 mb-3 p-5">{t('analytics.loading')}</p>
              ) : (
                <>
                  {/* Overview stat tiles */}
                  <div className="bg-white border border-[#e8e8e6] rounded-xl px-5 py-[18px] mb-6 shadow-[0_1px_3px_rgba(0,0,0,0.05)] last:mb-0">
                  <h2 className="flex items-center gap-2 text-base font-bold text-[#222] mt-0 mx-0 before:content-[''] before:w-1 before:h-[18px] before:bg-[#2a78d6] before:rounded-sm before:shrink-0 mb-3">{t('analytics.overview')}</h2>
                  <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3 mb-6">
                    <div className="bg-[#fafafa] border border-[#eee] rounded-lg px-4 py-3.5">
                      <p className="text-xs text-[#888] mt-0 mx-0 mb-1.5 uppercase tracking-[0.3px]">{t('analytics.sellThroughRate')}</p>
                      <p className="text-xl font-bold text-[#111] m-0">{(summary?.sellThroughRate ?? 0).toFixed(0)}%</p>
                    </div>
                    <div className="bg-[#fafafa] border border-[#eee] rounded-lg px-4 py-3.5">
                      <p className="text-xs text-[#888] mt-0 mx-0 mb-1.5 uppercase tracking-[0.3px]">{t('analytics.totalRevenue')}</p>
                      <p className="text-xl font-bold text-[#111] m-0">RM {(summary?.totalRevenue ?? 0).toFixed(2)}</p>
                    </div>
                    <div className="bg-[#fafafa] border border-[#eee] rounded-lg px-4 py-3.5">
                      <p className="text-xs text-[#888] mt-0 mx-0 mb-1.5 uppercase tracking-[0.3px]">{t('analytics.activeListings')}</p>
                      <p className="text-xl font-bold text-[#111] m-0">{summary?.itemsActive ?? 0}</p>
                    </div>
                    <div className="bg-[#fafafa] border border-[#eee] rounded-lg px-4 py-3.5">
                      <p className="text-xs text-[#888] mt-0 mx-0 mb-1.5 uppercase tracking-[0.3px]">{t('analytics.pendingOrders')}</p>
                      <p className="text-xl font-bold text-[#111] m-0">{summary?.pendingOrders ?? 0}</p>
                    </div>
                    <div className="bg-[#fafafa] border border-[#eee] rounded-lg px-4 py-3.5">
                      <p className="text-xs text-[#888] mt-0 mx-0 mb-1.5 uppercase tracking-[0.3px]">{t('analytics.itemsSold')}</p>
                      <p className="text-xl font-bold text-[#111] m-0">{summary?.itemsSold ?? 0}</p>
                    </div>
                    <div className="bg-[#fafafa] border border-[#eee] rounded-lg px-4 py-3.5">
                      <p className="text-xs text-[#888] mt-0 mx-0 mb-1.5 uppercase tracking-[0.3px]">{t('analytics.archived')}</p>
                      <p className="text-xl font-bold text-[#111] m-0">{summary?.itemsArchived ?? 0}</p>
                    </div>
                    <div className="bg-[#fafafa] border border-[#eee] rounded-lg px-4 py-3.5">
                      <p className="text-xs text-[#888] mt-0 mx-0 mb-1.5 uppercase tracking-[0.3px]">{t('analytics.avgDaysToSell')}</p>
                      <p className="text-xl font-bold text-[#111] m-0">
                        {(summary?.avgDaysToSell ?? 0) > 0 ? (summary!.avgDaysToSell).toFixed(1) : '—'}
                      </p>
                    </div>
                  </div>

                  </div>

                  {/* Sales trends: stacked monthly bar chart with a metric toggle
                      and year / month / category filter chips */}
                  <div className="bg-white border border-[#e8e8e6] rounded-xl px-5 py-[18px] mb-6 shadow-[0_1px_3px_rgba(0,0,0,0.05)] last:mb-0">
                  <h2 className="flex items-center gap-2 text-base font-bold text-[#222] mt-0 mx-0 before:content-[''] before:w-1 before:h-[18px] before:bg-[#2a78d6] before:rounded-sm before:shrink-0 mb-3">{t('analytics.salesTrends')}</h2>
                  <div className="border border-[#ececec] rounded-[10px] pt-4 px-3.5 pb-2 mb-7 bg-[#fdfdfc]">
                    <div className="flex justify-between items-center gap-3 flex-wrap mt-0 mx-0 mb-3.5">
                      <div className="inline-flex bg-[#f1f1ef] border border-[#e3e2dd] rounded-[10px] p-[3px] gap-0.5">
                        <button
                          className={`border-none px-4 py-[7px] rounded-lg text-[13.5px] font-semibold cursor-pointer transition-all duration-150 ${chartMetric === 'revenue' ? 'bg-white text-[#111] shadow-[0_1px_2px_rgba(0,0,0,0.12)]' : 'bg-transparent text-[#666] hover:text-[#222]'}`}
                          onClick={() => setChartMetric('revenue')}
                        >
                          {t('analytics.monthlyRevenue')}
                        </button>
                        <button
                          className={`border-none px-4 py-[7px] rounded-lg text-[13.5px] font-semibold cursor-pointer transition-all duration-150 ${chartMetric === 'orderCount' ? 'bg-white text-[#111] shadow-[0_1px_2px_rgba(0,0,0,0.12)]' : 'bg-transparent text-[#666] hover:text-[#222]'}`}
                          onClick={() => setChartMetric('orderCount')}
                        >
                          {t('analytics.itemsSold')}
                        </button>
                      </div>
                      <button className="border rounded-lg px-3.5 py-[7px] text-[13px] font-semibold cursor-pointer transition-[border-color] duration-150 bg-white border-[#ccc] text-[#333] hover:border-[#888]" onClick={exportChartCsv}>
                        {t('analytics.exportCsv')}
                      </button>
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap mt-0 mx-0 mb-4">
                      <span className="text-[11px] text-[#898781] uppercase tracking-[0.4px] font-bold mr-0.5 [&:not(:first-child)]:ml-3">{t('analytics.year')}</span>
                      <button
                        className={`inline-flex items-center gap-1.5 border rounded-2xl px-3 py-1 text-[13px] cursor-pointer transition-all duration-150 ${allYearsOn ? 'bg-[#111] border-[#111] text-white font-semibold' : 'bg-white border-[#ddd] text-[#444] hover:border-[#999]'}`}
                        onClick={() => setSelectedYears(allYearsOn ? [] : null)}
                        title={allYearsOn ? t('analytics.deselectAll') : t('analytics.selectAll')}
                      >
                        {t('analytics.all')}
                      </button>
                      {chartYears.map((y) => {
                        const on = activeYears.includes(y);
                        return (
                          <button
                            key={y}
                            className={`inline-flex items-center gap-1.5 border rounded-2xl px-3 py-1 text-[13px] cursor-pointer transition-all duration-150 ${on ? 'bg-[#f5f5f3] border-[#999] text-[#111] font-semibold' : 'bg-white border-[#ddd] text-[#444] opacity-45 hover:opacity-80 hover:border-[#999]'}`}
                            onClick={() => toggleInList(setSelectedYears, y, chartYears)}
                          >
                            {y}
                            <span className="text-[11px] w-3 text-center text-[#0a7a0a]">{on ? '✓' : ''}</span>
                          </button>
                        );
                      })}
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap mt-0 mx-0 mb-4">
                      <span className="text-[11px] text-[#898781] uppercase tracking-[0.4px] font-bold mr-0.5 [&:not(:first-child)]:ml-3">{t('analytics.month')}</span>
                      <button
                        className={`inline-flex items-center gap-1.5 border rounded-2xl px-3 py-1 text-[13px] cursor-pointer transition-all duration-150 ${allMonthsOn ? 'bg-[#111] border-[#111] text-white font-semibold' : 'bg-white border-[#ddd] text-[#444] hover:border-[#999]'}`}
                        onClick={() => setSelectedMonths(allMonthsOn ? [] : null)}
                        title={allMonthsOn ? t('analytics.deselectAll') : t('analytics.selectAll')}
                      >
                        {t('analytics.all')}
                      </button>
                      {chartMonthParts.map((m) => {
                        const on = activeMonths.includes(m);
                        return (
                          <button
                            key={m}
                            className={`inline-flex items-center gap-1.5 border rounded-2xl px-3 py-1 text-[13px] cursor-pointer transition-all duration-150 ${on ? 'bg-[#f5f5f3] border-[#999] text-[#111] font-semibold' : 'bg-white border-[#ddd] text-[#444] opacity-45 hover:opacity-80 hover:border-[#999]'}`}
                            onClick={() => toggleInList(setSelectedMonths, m, chartMonthParts)}
                          >
                            {t(`months.${m}`)}
                            <span className="text-[11px] w-3 text-center text-[#0a7a0a]">{on ? '✓' : ''}</span>
                          </button>
                        );
                      })}
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap mt-0 mx-0 mb-4">
                      <span className="text-[11px] text-[#898781] uppercase tracking-[0.4px] font-bold mr-0.5 [&:not(:first-child)]:ml-3">{t('analytics.categories')}</span>
                      <button
                        className={`inline-flex items-center gap-1.5 border rounded-2xl px-3 py-1 text-[13px] cursor-pointer transition-all duration-150 ${allCatsOn ? 'bg-[#111] border-[#111] text-white font-semibold' : 'bg-white border-[#ddd] text-[#444] hover:border-[#999]'}`}
                        onClick={() => setSelectedCats(allCatsOn ? [] : null)}
                        title={allCatsOn ? t('analytics.deselectAll') : t('analytics.selectAll')}
                      >
                        {t('analytics.all')}
                      </button>
                      {chartCategories.map((cat) => {
                        const on = activeCats.includes(cat);
                        return (
                          <button
                            key={cat}
                            className={`inline-flex items-center gap-1.5 border rounded-2xl px-3 py-1 text-[13px] cursor-pointer transition-all duration-150 ${on ? 'bg-[#f5f5f3] border-[#999] text-[#111] font-semibold' : 'bg-white border-[#ddd] text-[#444] opacity-45 hover:opacity-80 hover:border-[#999]'}`}
                            onClick={() => toggleCat(cat)}
                            title={on ? t('analytics.hideCat', { name: cat }) : t('analytics.showCat', { name: cat })}
                          >
                            <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: catColor(cat) }} />
                            {cat}
                            <span className="text-[11px] w-3 text-center text-[#0a7a0a]">{on ? '✓' : ''}</span>
                          </button>
                        );
                      })}
                    </div>

                    {chartData.length > 0 ? (
                      <div className="w-full h-[280px] mb-8">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={chartData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e1e0d9" vertical={false} />
                            <XAxis
                              dataKey="month"
                              tick={{ fill: '#898781', fontSize: 12 }}
                              tickFormatter={formatChartMonth}
                            />
                            <YAxis
                              allowDecimals={chartMetric === 'revenue'}
                              tick={{ fill: '#898781', fontSize: 12 }}
                            />
                            <Tooltip
                              labelFormatter={(label) => formatChartMonth(String(label))}
                              formatter={(value, name) => {
                                const n = Number(Array.isArray(value) ? value[0] : value ?? 0);
                                return [
                                  chartMetric === 'revenue'
                                    ? `RM ${n.toFixed(2)}`
                                    : t('analytics.itemsTooltip', { count: n }),
                                  String(name),
                                ];
                              }}
                            />
                            <Legend />
                            {visibleCategories.map((cat) => (
                              <Bar
                                key={cat}
                                dataKey={cat}
                                stackId="stack"
                                fill={catColor(cat)}
                                stroke="#ffffff"
                                strokeWidth={1}
                                maxBarSize={48}
                              />
                            ))}
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <p className="text-[#888] text-[15px] mt-0 mx-0 mb-3 p-5">{t('analytics.noChartData')}</p>
                    )}
                  </div>
                  </div>

                  {/* Sales by category — click a row to expand the sold items behind it */}
                  {sortedCategories.length > 0 && (
                    <div className="bg-white border border-[#e8e8e6] rounded-xl px-5 py-[18px] mb-6 shadow-[0_1px_3px_rgba(0,0,0,0.05)] last:mb-0">
                      <div className="flex justify-between items-center gap-3 mt-0 mx-0 mb-3">
                        <h2 className="flex items-center gap-2 text-base font-bold text-[#222] mt-0 mx-0 before:content-[''] before:w-1 before:h-[18px] before:bg-[#2a78d6] before:rounded-sm before:shrink-0 mb-0">{t('analytics.salesByCategory')}</h2>
                        <button className="border rounded-lg px-3.5 py-[7px] text-[13px] font-semibold cursor-pointer transition-[border-color] duration-150 bg-white border-[#ccc] text-[#333] hover:border-[#888]" onClick={exportCategoryCsv}>
                          {t('analytics.exportCsv')}
                        </button>
                      </div>
                      <div className="w-full overflow-x-auto">
                        <table className="w-full border-collapse text-sm [&_th]:text-left [&_th]:px-3 [&_th]:py-2.5 [&_th]:border-b-2 [&_th]:border-b-[#eee] [&_th]:text-[#666] [&_th]:font-semibold [&_th]:whitespace-nowrap [&_td]:px-3 [&_td]:py-2.5 [&_td]:border-b [&_td]:border-b-[#f0f0f0] [&_td]:whitespace-nowrap [&_tr:last-child_td]:border-b-0">
                          <thead>
                            <tr>
                              <th className="cursor-pointer select-none hover:text-[#222]" onClick={() => toggleCatSort('category')}>
                                {t('analytics.category')}{sortArrow(catSort?.key === 'category', catSort?.dir ?? 1)}
                              </th>
                              <th className="cursor-pointer select-none hover:text-[#222]" onClick={() => toggleCatSort('itemsSold')}>
                                {t('analytics.itemsSold')}{sortArrow(catSort?.key === 'itemsSold', catSort?.dir ?? 1)}
                              </th>
                              <th className="cursor-pointer select-none hover:text-[#222]" onClick={() => toggleCatSort('avgDays')}>
                                {t('analytics.avgDaysToSell')}{sortArrow(catSort?.key === 'avgDays', catSort?.dir ?? 1)}
                              </th>
                              <th className="cursor-pointer select-none hover:text-[#222]" onClick={() => toggleCatSort('revenue')}>
                                {t('analytics.totalRevenue')}{sortArrow(catSort?.key === 'revenue', catSort?.dir ?? 1)}
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {sortedCategories.map((cs) => {
                              const expanded = expandedCats.has(cs.category);
                              const soldInCat = itemStats.filter(
                                (it) => it.category === cs.category && it.sold,
                              );
                              return (
                                <Fragment key={cs.category}>
                                  <tr
                                    className="cursor-pointer [&:hover_td]:bg-[#fafaf8]"
                                    onClick={() => toggleExpandCat(cs.category)}
                                  >
                                    <td>
                                      <span className="inline-block w-4 text-[#898781] text-xs">{expanded ? '▾' : '▸'}</span>
                                      <span
                                        className="inline-block w-2 h-2 rounded-full shrink-0"
                                        style={{ background: catColor(cs.category), marginRight: 6 }}
                                      />
                                      {cs.category}
                                    </td>
                                    <td>{cs.itemsSold}</td>
                                    <td>{cs.avgDays > 0 ? cs.avgDays.toFixed(1) : '—'}</td>
                                    <td>RM {cs.revenue.toFixed(2)}</td>
                                  </tr>
                                  {expanded && (
                                    <tr className="[&>td]:bg-[#fbfbf9] [&>td]:pt-2 [&>td]:pr-3 [&>td]:pb-3.5 [&>td]:pl-7">
                                      <td colSpan={4}>
                                        {soldInCat.length === 0 ? (
                                          <p className="text-[#898781] text-[13px] my-1 mx-0">
                                            {t('analytics.noSoldInCategory')}
                                          </p>
                                        ) : (
                                          <table className="w-full border-collapse text-[13px] [&_th]:text-left [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:text-[#898781] [&_th]:font-semibold [&_th]:text-xs [&_th]:border-b [&_th]:border-b-[#ececea] [&_th]:whitespace-nowrap [&_td]:px-2.5 [&_td]:py-1.5 [&_td]:border-b [&_td]:border-b-[#f2f2f0] [&_td]:whitespace-nowrap [&_tr:last-child_td]:border-b-0">
                                            <thead>
                                              <tr>
                                                <th className="w-9 text-[#898781] text-xs text-right">#</th>
                                                <th>{t('analytics.item')}</th>
                                                <th>{t('analytics.soldDate')}</th>
                                                <th>{t('analytics.daysToSell')}</th>
                                                <th>{t('analytics.revenue')}</th>
                                              </tr>
                                            </thead>
                                            <tbody>
                                              {soldInCat.map((it, idx) => (
                                                <tr key={it.listingId}>
                                                  <td className="w-9 text-[#898781] text-xs text-right">{idx + 1}</td>
                                                  <td>
                                                    <Link
                                                      href={`/products/${it.listingId}`}
                                                      className="text-sm text-[#2563eb] no-underline font-medium hover:underline"
                                                    >
                                                      {it.title}
                                                    </Link>
                                                  </td>
                                                  <td>{it.soldAt ?? '—'}</td>
                                                  <td>{it.daysListed}</td>
                                                  <td>RM {it.revenue.toFixed(2)}</td>
                                                </tr>
                                              ))}
                                            </tbody>
                                          </table>
                                        )}
                                      </td>
                                    </tr>
                                  )}
                                </Fragment>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* My Items — filterable, sortable, paginated table of every listing */}
                  <div className="bg-white border border-[#e8e8e6] rounded-xl px-5 py-[18px] mb-6 shadow-[0_1px_3px_rgba(0,0,0,0.05)] last:mb-0">
                  {itemStats.some((it) => it.stale) && (
                    <p className="bg-[#fff8e1] border border-[#ffe082] rounded-md text-[#8d6e00] text-sm px-3.5 py-2.5 mt-0 mx-0 mb-5">
                      {t('analytics.staleBanner', {
                        count: itemStats.filter((it) => it.stale).length,
                      })}
                    </p>
                  )}

                  <div className="flex justify-between items-center gap-3 mt-0 mx-0 mb-3">
                    <h2 className="flex items-center gap-2 text-base font-bold text-[#222] mt-0 mx-0 before:content-[''] before:w-1 before:h-[18px] before:bg-[#2a78d6] before:rounded-sm before:shrink-0 mb-0">{t('analytics.myItems')}</h2>
                    {itemStats.length > 0 && (
                      <div className="flex gap-2 items-center">
                        <button
                          className={`border rounded-lg px-3.5 py-[7px] text-[13px] font-semibold cursor-pointer transition-[border-color] duration-150 ${activeFilterCount > 0 ? 'bg-[#111] border-[#111] text-white' : 'bg-white border-[#ccc] text-[#333] hover:border-[#888]'}`}
                          onClick={() => setShowItemFilters((s) => !s)}
                        >
                          {t('analytics.filters')}{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
                        </button>
                        <button className="border rounded-lg px-3.5 py-[7px] text-[13px] font-semibold cursor-pointer transition-[border-color] duration-150 bg-white border-[#ccc] text-[#333] hover:border-[#888]" onClick={exportItemsCsv}>
                          {t('analytics.exportCsv')}
                        </button>
                      </div>
                    )}
                  </div>

                  {showItemFilters && itemStats.length > 0 && (
                    <div className="border border-[#ececec] rounded-[10px] bg-[#fdfdfc] p-3.5 mt-0 mx-0 mb-4">
                      <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-3 mb-3">
                        <label className="flex flex-col gap-1">
                          <span className="text-[11px] text-[#898781] uppercase tracking-[0.4px] font-bold">{t('analytics.itemName')}</span>
                          <input
                            type="text"
                            className="border border-[#ddd] rounded-lg px-2.5 py-1.5 text-[13px] text-[#333] w-full min-w-0 bg-white focus:outline-none focus:border-[#888]"
                            placeholder={t('analytics.searchTitle')}
                            value={itemFilters.search}
                            onChange={(e) =>
                              setItemFilters((f) => ({ ...f, search: e.target.value }))
                            }
                          />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="text-[11px] text-[#898781] uppercase tracking-[0.4px] font-bold">{t('analytics.priceRm')}</span>
                          <span className="flex items-center gap-1.5">
                            <input
                              type="number"
                              min="0"
                              className="border border-[#ddd] rounded-lg px-2.5 py-1.5 text-[13px] text-[#333] w-full min-w-0 bg-white focus:outline-none focus:border-[#888]"
                              placeholder={t('analytics.min')}
                              value={itemFilters.priceMin}
                              onChange={(e) =>
                                setItemFilters((f) => ({ ...f, priceMin: e.target.value.replace(/-/g, '') }))
                              }
                            />
                            <span className="text-[#aaa]">–</span>
                            <input
                              type="number"
                              min="0"
                              className="border border-[#ddd] rounded-lg px-2.5 py-1.5 text-[13px] text-[#333] w-full min-w-0 bg-white focus:outline-none focus:border-[#888]"
                              placeholder={t('analytics.max')}
                              value={itemFilters.priceMax}
                              onChange={(e) =>
                                setItemFilters((f) => ({ ...f, priceMax: e.target.value.replace(/-/g, '') }))
                              }
                            />
                          </span>
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="text-[11px] text-[#898781] uppercase tracking-[0.4px] font-bold">{t('analytics.daysListed')}</span>
                          <span className="flex items-center gap-1.5">
                            <input
                              type="number"
                              min="0"
                              className="border border-[#ddd] rounded-lg px-2.5 py-1.5 text-[13px] text-[#333] w-full min-w-0 bg-white focus:outline-none focus:border-[#888]"
                              placeholder={t('analytics.min')}
                              value={itemFilters.daysMin}
                              onChange={(e) =>
                                setItemFilters((f) => ({ ...f, daysMin: e.target.value.replace(/-/g, '') }))
                              }
                            />
                            <span className="text-[#aaa]">–</span>
                            <input
                              type="number"
                              min="0"
                              className="border border-[#ddd] rounded-lg px-2.5 py-1.5 text-[13px] text-[#333] w-full min-w-0 bg-white focus:outline-none focus:border-[#888]"
                              placeholder={t('analytics.max')}
                              value={itemFilters.daysMax}
                              onChange={(e) =>
                                setItemFilters((f) => ({ ...f, daysMax: e.target.value.replace(/-/g, '') }))
                              }
                            />
                          </span>
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="text-[11px] text-[#898781] uppercase tracking-[0.4px] font-bold">{t('analytics.views30d')}</span>
                          <span className="flex items-center gap-1.5">
                            <input
                              type="number"
                              min="0"
                              className="border border-[#ddd] rounded-lg px-2.5 py-1.5 text-[13px] text-[#333] w-full min-w-0 bg-white focus:outline-none focus:border-[#888]"
                              placeholder={t('analytics.min')}
                              value={itemFilters.viewsMin}
                              onChange={(e) =>
                                setItemFilters((f) => ({ ...f, viewsMin: e.target.value.replace(/-/g, '') }))
                              }
                            />
                            <span className="text-[#aaa]">–</span>
                            <input
                              type="number"
                              min="0"
                              className="border border-[#ddd] rounded-lg px-2.5 py-1.5 text-[13px] text-[#333] w-full min-w-0 bg-white focus:outline-none focus:border-[#888]"
                              placeholder={t('analytics.max')}
                              value={itemFilters.viewsMax}
                              onChange={(e) =>
                                setItemFilters((f) => ({ ...f, viewsMax: e.target.value.replace(/-/g, '') }))
                              }
                            />
                          </span>
                        </label>
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap mt-0 mx-0 mb-4">
                        <span className="text-[11px] text-[#898781] uppercase tracking-[0.4px] font-bold mr-0.5 [&:not(:first-child)]:ml-3">{t('analytics.category')}</span>
                        <button
                          className={`inline-flex items-center gap-1.5 border rounded-2xl px-3 py-1 text-[13px] cursor-pointer transition-all duration-150 ${itemFilters.cats === null || itemFilters.cats.length === itemCategories.length ? 'bg-[#111] border-[#111] text-white font-semibold' : 'bg-white border-[#ddd] text-[#444] hover:border-[#999]'}`}
                          onClick={() =>
                            setItemFilters((f) => ({
                              ...f,
                              cats:
                                f.cats === null || f.cats.length === itemCategories.length
                                  ? []
                                  : null,
                            }))
                          }
                        >
                          {t('analytics.all')}
                        </button>
                        {itemCategories.map((cat) => {
                          const on = (itemFilters.cats ?? itemCategories).includes(cat);
                          return (
                            <button
                              key={cat}
                              className={`inline-flex items-center gap-1.5 border rounded-2xl px-3 py-1 text-[13px] cursor-pointer transition-all duration-150 ${on ? 'bg-[#f5f5f3] border-[#999] text-[#111] font-semibold' : 'bg-white border-[#ddd] text-[#444] opacity-45 hover:opacity-80 hover:border-[#999]'}`}
                              onClick={() => toggleFilterList('cats', cat, itemCategories)}
                            >
                              {cat}
                              <span className="text-[11px] w-3 text-center text-[#0a7a0a]">{on ? '✓' : ''}</span>
                            </button>
                          );
                        })}
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap mt-0 mx-0 mb-4">
                        <span className="text-[11px] text-[#898781] uppercase tracking-[0.4px] font-bold mr-0.5 [&:not(:first-child)]:ml-3">{t('analytics.statusLabel')}</span>
                        <button
                          className={`inline-flex items-center gap-1.5 border rounded-2xl px-3 py-1 text-[13px] cursor-pointer transition-all duration-150 ${itemFilters.statuses === null || itemFilters.statuses.length === ITEM_STATUSES.length ? 'bg-[#111] border-[#111] text-white font-semibold' : 'bg-white border-[#ddd] text-[#444] hover:border-[#999]'}`}
                          onClick={() =>
                            setItemFilters((f) => ({
                              ...f,
                              statuses:
                                f.statuses === null || f.statuses.length === ITEM_STATUSES.length
                                  ? []
                                  : null,
                            }))
                          }
                        >
                          {t('analytics.all')}
                        </button>
                        {ITEM_STATUSES.map((st) => {
                          const on = (itemFilters.statuses ?? ITEM_STATUSES).includes(st);
                          return (
                            <button
                              key={st}
                              className={`inline-flex items-center gap-1.5 border rounded-2xl px-3 py-1 text-[13px] cursor-pointer transition-all duration-150 ${on ? 'bg-[#f5f5f3] border-[#999] text-[#111] font-semibold' : 'bg-white border-[#ddd] text-[#444] opacity-45 hover:opacity-80 hover:border-[#999]'}`}
                              onClick={() => toggleFilterList('statuses', st, ITEM_STATUSES)}
                            >
                              {t(`status.${st}`)}
                              <span className="text-[11px] w-3 text-center text-[#0a7a0a]">{on ? '✓' : ''}</span>
                            </button>
                          );
                        })}
                        <span className="text-[11px] text-[#898781] uppercase tracking-[0.4px] font-bold mr-0.5 [&:not(:first-child)]:ml-3">{t('analytics.sold')}</span>
                        {(['all', 'sold', 'unsold'] as const).map((s) => (
                          <button
                            key={s}
                            className={`inline-flex items-center gap-1.5 border rounded-2xl px-3 py-1 text-[13px] cursor-pointer transition-all duration-150 ${itemFilters.sold === s ? 'bg-[#111] border-[#111] text-white font-semibold' : 'bg-white border-[#ddd] text-[#444] hover:border-[#999]'}`}
                            onClick={() => setItemFilters((f) => ({ ...f, sold: s }))}
                          >
                            {s === 'all'
                              ? t('analytics.all')
                              : s === 'sold'
                                ? t('analytics.sold')
                                : t('analytics.notSold')}
                          </button>
                        ))}
                        <button className="border-none bg-none text-[#c2185b] text-[13px] font-semibold cursor-pointer ml-auto px-2 py-1 hover:underline" onClick={clearItemFilters}>
                          {t('analytics.clearAll')}
                        </button>
                      </div>
                      <p className="text-xs text-[#898781] mt-2 mx-0 mb-0">
                        {t('analytics.showingCount', {
                          shown: sortedItems.length,
                          total: itemStats.length,
                        })}
                      </p>
                    </div>
                  )}

                  {itemStats.length === 0 ? (
                    <p className="text-[#888] text-[15px] mt-0 mx-0 mb-3 p-5">{t('analytics.noListings')}</p>
                  ) : sortedItems.length === 0 ? (
                    <p className="text-[#888] text-[15px] mt-0 mx-0 mb-3 p-5">{t('analytics.noMatches')}</p>
                  ) : (
                    <div className="w-full overflow-x-auto">
                      <table className="w-full border-collapse text-sm [&_th]:text-left [&_th]:px-3 [&_th]:py-2.5 [&_th]:border-b-2 [&_th]:border-b-[#eee] [&_th]:text-[#666] [&_th]:font-semibold [&_th]:whitespace-nowrap [&_td]:px-3 [&_td]:py-2.5 [&_td]:border-b [&_td]:border-b-[#f0f0f0] [&_td]:whitespace-nowrap [&_tr:last-child_td]:border-b-0">
                        <thead>
                          <tr>
                            <th className="w-9 text-[#898781] text-xs text-right">#</th>
                            <th className="cursor-pointer select-none hover:text-[#222]" onClick={() => toggleItemSort('title')}>
                              {t('analytics.item')}{sortArrow(itemSort?.key === 'title', itemSort?.dir ?? 1)}
                            </th>
                            <th className="cursor-pointer select-none hover:text-[#222]" onClick={() => toggleItemSort('price')}>
                              {t('analytics.price')}{sortArrow(itemSort?.key === 'price', itemSort?.dir ?? 1)}
                            </th>
                            <th className="cursor-pointer select-none hover:text-[#222]" onClick={() => toggleItemSort('category')}>
                              {t('analytics.category')}{sortArrow(itemSort?.key === 'category', itemSort?.dir ?? 1)}
                            </th>
                            <th className="cursor-pointer select-none hover:text-[#222]" onClick={() => toggleItemSort('status')}>
                              {t('analytics.statusLabel')}{sortArrow(itemSort?.key === 'status', itemSort?.dir ?? 1)}
                            </th>
                            <th className="cursor-pointer select-none hover:text-[#222]" onClick={() => toggleItemSort('daysListed')}>
                              {t('analytics.daysListedCol')}{sortArrow(itemSort?.key === 'daysListed', itemSort?.dir ?? 1)}
                            </th>
                            <th className="cursor-pointer select-none hover:text-[#222]" onClick={() => toggleItemSort('viewsLast30Days')}>
                              {t('analytics.views30d')}{sortArrow(itemSort?.key === 'viewsLast30Days', itemSort?.dir ?? 1)}
                            </th>
                            <th className="cursor-pointer select-none hover:text-[#222]" onClick={() => toggleItemSort('soldAt')}>
                              {t('analytics.sold')}{sortArrow(itemSort?.key === 'soldAt', itemSort?.dir ?? 1)}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {pagedItems.map((it, idx) => (
                            <tr key={it.listingId} className={it.stale ? '[&>td]:bg-[#fffdf5]' : ''}>
                              <td className="w-9 text-[#898781] text-xs text-right">
                                {(clampedItemPage - 1) * ITEMS_PER_PAGE + idx + 1}
                              </td>
                              <td>
                                <Link href={`/products/${it.listingId}`} className="text-sm text-[#2563eb] no-underline font-medium hover:underline">
                                  {it.title}
                                </Link>
                                {it.stale && <span className="inline-block ml-1.5 px-2 py-px rounded-[10px] bg-[#fff3cd] text-[#8d6e00] text-[11px] font-semibold uppercase tracking-[0.3px]"> {t('analytics.stale')}</span>}
                              </td>
                              <td>RM {it.price.toFixed(2)}</td>
                              <td>{it.category}</td>
                              <td>{t(`status.${it.status}`)}</td>
                              <td>{it.daysListed}</td>
                              <td>{it.viewsLast30Days}</td>
                              <td>
                                {it.sold
                                  ? `✓${it.soldAt ? ` ${it.soldAt}` : ''}`
                                  : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {itemTotalPages > 1 && (
                    <div className="flex justify-center items-center gap-1.5 p-4 border-t border-[#eee]">
                      <button
                        className="w-9 h-9 rounded border cursor-pointer text-sm flex items-center justify-center transition-[border-color] duration-150 disabled:opacity-40 disabled:cursor-not-allowed bg-white border-[#ddd] text-[#444] enabled:hover:border-[#888]"
                        disabled={clampedItemPage === 1}
                        onClick={() => setItemPage((p) => Math.max(1, p - 1))}
                      >
                        ‹
                      </button>
                      {Array.from({ length: itemTotalPages }, (_, i) => (
                        <button
                          key={i + 1}
                          className={`w-9 h-9 rounded border cursor-pointer text-sm flex items-center justify-center transition-[border-color] duration-150 disabled:opacity-40 disabled:cursor-not-allowed ${clampedItemPage === i + 1 ? 'bg-[#2563eb] text-white border-[#2563eb]' : 'bg-white border-[#ddd] text-[#444] enabled:hover:border-[#888]'}`}
                          onClick={() => setItemPage(i + 1)}
                        >
                          {i + 1}
                        </button>
                      ))}
                      <button
                        className="w-9 h-9 rounded border cursor-pointer text-sm flex items-center justify-center transition-[border-color] duration-150 disabled:opacity-40 disabled:cursor-not-allowed bg-white border-[#ddd] text-[#444] enabled:hover:border-[#888]"
                        disabled={clampedItemPage === itemTotalPages}
                        onClick={() => setItemPage((p) => Math.min(itemTotalPages, p + 1))}
                      >
                        ›
                      </button>
                    </div>
                  )}
                  </div>
                </>
              )}
            </div>
          ) : activeTab === 'pending' ? (
            /* Pending orders awaiting the seller's delivery confirmation */
            pendingLoading ? (
              <p className="text-[#888] text-[15px] mt-0 mx-0 mb-3 p-5">Loading pending orders…</p>
            ) : pendingOrders.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <p className="text-[#888] text-[15px] mt-0 mx-0 mb-3 p-5">No pending orders to deliver.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {pendingOrders.map((order, i) => (
                  <div key={order.id} className="flex items-center gap-3.5 p-4 border-b border-[#f0f0ed] last:border-b-0">
                    <span className="w-7 shrink-0 text-[#898781] text-[13px] font-semibold pt-1 text-right">{i + 1}</span>
                    <div className="w-[110px] h-[90px] shrink-0 rounded-md overflow-hidden bg-[#f0f0f0] max-[600px]:w-full max-[600px]:h-[200px]">
                      <img
                        className="w-full h-full object-cover"
                        src={orderImgSrc(order)}
                        alt={order.listingTitle}
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = PLACEHOLDER_IMAGE;
                        }}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[17px] font-bold text-[#111] mt-0 mx-0 mb-1">RM {order.totalPrice.toFixed(2)}</p>
                      <Link href={`/products/${order.listingId}`} className="block text-[15px] font-medium text-[#333] no-underline mb-1 whitespace-nowrap overflow-hidden text-ellipsis hover:text-[#2563eb] hover:underline">
                        {order.listingTitle}
                      </Link>
                      <p className="text-[13px] text-[#888] mt-0 mx-0 mb-[3px]">
                        Buyer: {order.buyerUsername || order.buyerEmail || 'Buyer'}
                      </p>
                      <p className="text-[13px] text-[#888] mt-0 mx-0 mb-2.5">
                        Ordered {formatDate(order.createdAt)} · Qty {order.quantity} · {order.paymentMethod || 'meetup'}
                      </p>
                    </div>
                    {/* Same shape as the listing rows: status, age, actions. */}
                    <div className="ml-auto flex flex-col items-end gap-1.5 shrink-0 min-w-[130px]">
                      <span className="inline-block px-3 py-[3px] rounded-xl text-xs font-bold capitalize bg-[#fff8e1] text-[#8d6e00]">
                        Pending
                      </span>
                      {/* Age of the order, not the listing — how long the buyer
                          has been waiting on this seller. */}
                      <span className="text-xs text-[#898781]">
                        {daysSince(order.createdAt)} days waiting
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          className="bg-none border-none text-sm text-[#2563eb] cursor-pointer font-medium p-0 hover:underline disabled:text-[#a3a3a3] disabled:cursor-not-allowed disabled:no-underline"
                          onClick={() => handleCompleteOrder(order.id)}
                          disabled={completingOrderId === order.id}
                          type="button"
                        >
                          {completingOrderId === order.id ? 'Saving…' : 'Delivered'}
                        </button>
                        <span className="text-[#ccc] text-sm">|</span>
                        <button
                          className="bg-none border-none text-sm text-[#2563eb] cursor-pointer font-medium p-0 hover:underline"
                          onClick={() => setOrderDetails(order)}
                          type="button"
                        >
                          View Details
                        </button>
                        <span className="text-[#ccc] text-sm">|</span>
                        <button
                          className="bg-none border-none text-sm text-[#c62828] cursor-pointer font-medium p-0 hover:underline disabled:text-[#a3a3a3] disabled:cursor-not-allowed disabled:no-underline"
                          onClick={() => handleCancelOrder(order.id)}
                          disabled={cancellingOrderId === order.id}
                          type="button"
                        >
                          {cancellingOrderId === order.id ? 'Cancelling…' : 'Cancel'}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : loading ? (
            <p className="text-[#888] text-[15px] mt-0 mx-0 mb-3 p-5">{t('myShop.loadingAds')}</p>
          ) : paginatedAds.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <p className="text-[#888] text-[15px] mt-0 mx-0 mb-3 p-5">
                {activeTab === 'active'
                  ? t('myShop.emptyPublished')
                  : activeTab === 'sold'
                    ? t('myShop.emptySold')
                    : t('myShop.emptyArchived')}
              </p>
              {activeTab === 'active' && (
                <Link href="/sell" className="inline-block text-[#2563eb] font-semibold no-underline text-[15px] hover:underline">
                  {t('myShop.postFirstAd')}
                </Link>
              )}
            </div>
          ) : (
            /* Active / Sold / Archived listings of the open tab */
            paginatedAds.map((ad, i) => (
              <div key={ad.id} className="flex gap-4 px-5 py-4 border-b border-[#eee] items-start transition-colors duration-100 last:border-b-0 hover:bg-[#fafafa] max-[600px]:flex-col">
                <span className="w-7 shrink-0 text-[#898781] text-[13px] font-semibold pt-1 text-right">
                  {(page - 1) * ADS_PER_PAGE + i + 1}
                </span>
                <div className="w-[110px] h-[90px] shrink-0 rounded-md overflow-hidden bg-[#f0f0f0] max-[600px]:w-full max-[600px]:h-[200px]">
                  <img
                    className="w-full h-full object-cover"
                    src={imgSrc(ad)}
                    alt={ad.title}
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = PLACEHOLDER_IMAGE;
                    }}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[17px] font-bold text-[#111] mt-0 mx-0 mb-1">RM {ad.price.toFixed(2)}</p>
                  <Link href={`/products/${ad.id}`} className="block text-[15px] font-medium text-[#333] no-underline mb-1 whitespace-nowrap overflow-hidden text-ellipsis hover:text-[#2563eb] hover:underline">
                    {ad.title}
                  </Link>
                  <p className="text-[13px] text-[#888] mt-0 mx-0 mb-[3px]">
                    Posted {formatDate(ad.createdAt)} · {ad.location}
                  </p>
                  <p className="text-[13px] text-[#888] mt-0 mx-0 mb-2.5">
                    👁 {ad.viewsCount} views in the last 30 days
                  </p>
                </div>
                <div className="ml-auto flex flex-col items-end gap-1.5 shrink-0 min-w-[130px]">
                  <span
                    className={`inline-block px-3 py-[3px] rounded-xl text-xs font-bold capitalize ${
                      ad.status === 'active'
                        ? 'bg-[#e6f4ea] text-[#1a7f37]'
                        : ad.status === 'sold'
                          ? 'bg-[#e3edfb] text-[#1c5cab]'
                          : 'bg-[#efefec] text-[#6e6d68]'
                    }`}
                  >
                    {ad.status === 'active' ? 'Published' : ad.status}
                  </span>
                  <span className="text-xs text-[#898781]">
                    {daysSince(ad.createdAt)} days listed
                  </span>
                  {/* Actions differ per tab. Sold is terminal — the listing is a
                      record of a completed sale that revenue is derived from,
                      so it offers nothing: editing would rewrite history,
                      deleting would destroy it, and archiving would misfile a
                      sale as something the seller withdrew. */}
                  <div className="flex items-center gap-2">
                    {ad.status === 'sold' ? null : ad.status === 'archived' ? (
                      <>
                        <button
                          className="bg-none border-none text-sm text-[#2563eb] cursor-pointer font-medium p-0 hover:underline disabled:text-[#a3a3a3] disabled:cursor-not-allowed disabled:no-underline"
                          onClick={() => setPendingStatusChange({ ad, status: 'active' })}
                          disabled={statusChangingId === ad.id}
                          type="button"
                        >
                          {statusChangingId === ad.id ? 'Republishing…' : 'Republish'}
                        </button>
                        <span className="text-[#ccc] text-sm">|</span>
                        <button
                          className="bg-none border-none text-sm text-[#2563eb] cursor-pointer font-medium p-0 hover:underline"
                          onClick={() => setPendingDelete(ad)}
                          type="button"
                        >
                          Delete
                        </button>
                      </>
                    ) : (
                      <>
                        <Link
                          href={`/sell?editId=${ad.id}`}
                          className="text-sm text-[#2563eb] no-underline font-medium hover:underline"
                        >
                          Edit
                        </Link>
                        <span className="text-[#ccc] text-sm">|</span>
                        <button
                          className="bg-none border-none text-sm text-[#2563eb] cursor-pointer font-medium p-0 hover:underline disabled:text-[#a3a3a3] disabled:cursor-not-allowed disabled:no-underline"
                          onClick={() => setPendingStatusChange({ ad, status: 'archived' })}
                          disabled={statusChangingId === ad.id}
                          type="button"
                        >
                          {statusChangingId === ad.id ? 'Archiving…' : 'Archive'}
                        </button>
                        <span className="text-[#ccc] text-sm">|</span>
                        <button
                          className="bg-none border-none text-sm text-[#2563eb] cursor-pointer font-medium p-0 hover:underline"
                          onClick={() => setPendingDelete(ad)}
                          type="button"
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}

          {/* Pagination */}
          {activeTab !== 'analytics' && !loading && totalPages > 1 && (
            <div className="flex justify-center items-center gap-1.5 p-4 border-t border-[#eee]">
              <button
                className="w-9 h-9 rounded border cursor-pointer text-sm flex items-center justify-center transition-[border-color] duration-150 disabled:opacity-40 disabled:cursor-not-allowed bg-white border-[#ddd] text-[#444] enabled:hover:border-[#888]"
                disabled={page === 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                ‹
              </button>
              {Array.from({ length: totalPages }, (_, i) => (
                <button
                  key={i + 1}
                  className={`w-9 h-9 rounded border cursor-pointer text-sm flex items-center justify-center transition-[border-color] duration-150 disabled:opacity-40 disabled:cursor-not-allowed ${page === i + 1 ? 'bg-[#2563eb] text-white border-[#2563eb]' : 'bg-white border-[#ddd] text-[#444] enabled:hover:border-[#888]'}`}
                  onClick={() => setPage(i + 1)}
                >
                  {i + 1}
                </button>
              ))}
              <button
                className="w-9 h-9 rounded border cursor-pointer text-sm flex items-center justify-center transition-[border-color] duration-150 disabled:opacity-40 disabled:cursor-not-allowed bg-white border-[#ddd] text-[#444] enabled:hover:border-[#888]"
                disabled={page === totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                ›
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Deleting an ad cannot be undone, so it is confirmed here. The dialog
          names the listing so there is no doubt which one is going. */}
      {pendingDelete && (
        <div
          className="fixed inset-0 z-[1200] bg-black/40 flex items-center justify-center px-4"
          onClick={() => !deleting && setPendingDelete(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-ad-title"
            className="bg-white border border-[#e8e8e6] rounded-xl shadow-[0_10px_30px_rgba(0,0,0,0.2)] w-full max-w-[420px] px-5 py-[18px]"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="delete-ad-title" className="text-lg font-bold text-[#222] mt-0 mx-0 mb-2">
              Delete this ad?
            </h2>
            <p className="text-[#333] text-sm mt-0 mx-0 mb-1.5 font-semibold break-words">
              {pendingDelete.title}
            </p>
            <p className="text-[#898781] text-sm mt-0 mx-0 mb-5">
              This permanently removes the listing and its photos. It cannot be undone.
            </p>
            <div className="flex gap-2.5 justify-end flex-wrap">
              <button
                type="button"
                className="border border-[#ccc] bg-white rounded-lg px-3.5 py-[7px] text-[13px] font-semibold text-[#333] cursor-pointer transition-[border-color] duration-150 hover:border-[#888] disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => setPendingDelete(null)}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="inline-flex items-center px-[18px] py-[7px] rounded-lg bg-[#c62828] text-white border-none text-[13px] font-semibold cursor-pointer transition-colors duration-150 hover:bg-[#a91f1f] disabled:bg-[#a3a3a3] disabled:cursor-not-allowed"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? 'Deleting…' : 'Yes, delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Archiving pulls a listing out of circulation and republishing puts it
          back, so both are confirmed rather than firing on a single click. */}
      {pendingStatusChange && (
        <div
          className="fixed inset-0 z-[1200] bg-black/40 flex items-center justify-center px-4"
          onClick={() => statusChangingId === null && setPendingStatusChange(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="status-change-title"
            className="bg-white border border-[#e8e8e6] rounded-xl shadow-[0_10px_30px_rgba(0,0,0,0.2)] w-full max-w-[420px] px-5 py-[18px]"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="status-change-title" className="text-lg font-bold text-[#222] mt-0 mx-0 mb-2">
              {pendingStatusChange.status === 'archived' ? 'Archive this ad?' : 'Republish this ad?'}
            </h2>
            <p className="text-[#333] text-sm mt-0 mx-0 mb-1.5 font-semibold break-words">
              {pendingStatusChange.ad.title}
            </p>
            <p className="text-[#898781] text-sm mt-0 mx-0 mb-5">
              {pendingStatusChange.status === 'archived'
                ? 'It moves to your Archived tab and stops accepting new orders. You can republish it at any time.'
                : 'It moves back to your Published tab and can be ordered again. If it has no stock left, it returns as Sold instead.'}
            </p>
            <div className="flex gap-2.5 justify-end flex-wrap">
              <button
                type="button"
                className="border border-[#ccc] bg-white rounded-lg px-3.5 py-[7px] text-[13px] font-semibold text-[#333] cursor-pointer transition-[border-color] duration-150 hover:border-[#888] disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => setPendingStatusChange(null)}
                disabled={statusChangingId !== null}
              >
                Cancel
              </button>
              <button
                type="button"
                className="inline-flex items-center px-[18px] py-[7px] rounded-lg bg-[#111] text-white border-none text-[13px] font-semibold cursor-pointer transition-colors duration-150 hover:bg-[#333] disabled:bg-[#a3a3a3] disabled:cursor-not-allowed"
                onClick={() =>
                  handleSetStatus(pendingStatusChange.ad, pendingStatusChange.status)
                }
                disabled={statusChangingId !== null}
              >
                {statusChangingId !== null
                  ? pendingStatusChange.status === 'archived'
                    ? 'Archiving…'
                    : 'Republishing…'
                  : pendingStatusChange.status === 'archived'
                    ? 'Yes, archive'
                    : 'Yes, republish'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Everything the seller needs to fulfil one pending order. */}
      {orderDetails && (
        <div
          className="fixed inset-0 z-[1200] bg-black/40 flex items-center justify-center px-4 py-8"
          onClick={() => setOrderDetails(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="order-details-title"
            className="bg-white border border-[#e8e8e6] rounded-xl shadow-[0_10px_30px_rgba(0,0,0,0.2)] w-full max-w-[520px] max-h-full overflow-y-auto px-5 py-[18px]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 mb-4">
              <h2 id="order-details-title" className="text-lg font-bold text-[#222] m-0">
                Order #{orderDetails.id}
              </h2>
              <button
                type="button"
                className="bg-none border-none text-xl leading-none text-[#888] cursor-pointer p-0 hover:text-[#111]"
                onClick={() => setOrderDetails(null)}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="flex gap-3.5 mb-4">
              <div className="w-[90px] h-[75px] shrink-0 rounded-md overflow-hidden bg-[#f0f0f0]">
                <img
                  className="w-full h-full object-cover"
                  src={orderImgSrc(orderDetails)}
                  alt={orderDetails.listingTitle}
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = PLACEHOLDER_IMAGE;
                  }}
                />
              </div>
              <div className="min-w-0">
                <Link
                  href={`/products/${orderDetails.listingId}`}
                  className="block text-[15px] font-semibold text-[#333] no-underline mb-1 hover:text-[#2563eb] hover:underline"
                >
                  {orderDetails.listingTitle}
                </Link>
                <p className="text-[13px] text-[#888] m-0">{orderDetails.listingCategory}</p>
              </div>
            </div>

            <dl className="grid grid-cols-[minmax(110px,auto)_1fr] gap-x-4 gap-y-2.5 text-sm m-0">
              <dt className="text-[#898781]">Buyer</dt>
              <dd className="text-[#222] m-0 font-medium break-words">
                {orderDetails.buyerUsername || '—'}
              </dd>

              <dt className="text-[#898781]">Contact</dt>
              <dd className="m-0 break-words">
                {orderDetails.buyerEmail ? (
                  <a href={`mailto:${orderDetails.buyerEmail}`} className="text-[#2563eb] no-underline hover:underline">
                    {orderDetails.buyerEmail}
                  </a>
                ) : (
                  <span className="text-[#898781]">—</span>
                )}
              </dd>

              <dt className="text-[#898781]">Ordered</dt>
              <dd className="text-[#222] m-0">{formatDate(orderDetails.createdAt)}</dd>

              <dt className="text-[#898781]">Quantity</dt>
              <dd className="text-[#222] m-0">{orderDetails.quantity}</dd>

              <dt className="text-[#898781]">Unit price</dt>
              <dd className="text-[#222] m-0">RM {orderDetails.listingPrice.toFixed(2)}</dd>

              <dt className="text-[#898781]">Total</dt>
              <dd className="text-[#111] m-0 font-bold">RM {orderDetails.totalPrice.toFixed(2)}</dd>

              <dt className="text-[#898781]">Payment</dt>
              <dd className="text-[#222] m-0 capitalize">{orderDetails.paymentMethod || 'meetup'}</dd>

              <dt className="text-[#898781]">Status</dt>
              <dd className="m-0">
                <span className="inline-block px-3 py-[3px] rounded-xl text-xs font-bold capitalize bg-[#fff8e1] text-[#8d6e00]">
                  {orderDetails.status}
                </span>
              </dd>
            </dl>

            {/* Checkout never collects a delivery address, so there is none to
                show. Saying so beats leaving the seller hunting for it. */}
            <p className="text-[13px] text-[#898781] bg-[#faf9f7] border border-[#eee] rounded-lg px-3 py-2.5 mt-4 mb-0">
              No delivery address is recorded — checkout does not collect one. Arrange
              handover with the buyer using the contact above.
            </p>

            <div className="flex gap-2.5 justify-end flex-wrap mt-5">
              <button
                type="button"
                className="border border-[#ccc] bg-white rounded-lg px-3.5 py-[7px] text-[13px] font-semibold text-[#333] cursor-pointer transition-[border-color] duration-150 hover:border-[#888]"
                onClick={() => setOrderDetails(null)}
              >
                Close
              </button>
              <button
                type="button"
                className="inline-flex items-center px-[18px] py-[7px] rounded-lg bg-[#111] text-white border-none text-[13px] font-semibold cursor-pointer transition-colors duration-150 hover:bg-[#333] disabled:bg-[#a3a3a3] disabled:cursor-not-allowed"
                onClick={() => {
                  const id = orderDetails.id;
                  setOrderDetails(null);
                  handleCompleteOrder(id);
                }}
                disabled={completingOrderId === orderDetails.id}
              >
                Mark as Delivered
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

/* Page export — wraps the inner component in Suspense, which Next.js requires
   for useSearchParams (we read ?tab= to open the right tab on arrival). */
export default function MyAdsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-[#666]">Loading…</div>}>
      <MyAdsPageInner />
    </Suspense>
  );
}

'use client';

// My Shop — the seller dashboard page.
// Tabs Published / Pending Orders / Sold / Archived manage the seller's listings;
// the Analytics tab adds revenue stats, a monthly sales chart and per-item tables.
// Every label goes through t() (src/i18n) so the whole page — charts included —
// re-renders in the language picked in the header.

import { Fragment, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
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
import { downloadCsv } from '@/lib/csv';
import styles from './my-ads.module.css';

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
interface SellerOrder {
  id: number;
  listingId: number;
  quantity: number;
  totalPrice: number;
  status: string;
  paymentMethod: string;
  createdAt: string;
  listingTitle: string;
  listingImage: string;
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

export default function MyAdsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { showToast } = useToast();
  const { t } = useI18n();

  // "2026-03" → localized "Mar 2026" / "3月 2026"; re-renders with the active language.
  const formatChartMonth = (month: string) =>
    `${t(`months.${month.slice(5, 7)}`)} ${month.slice(0, 4)}`;

  // Open tab; each listing status keeps its own list so switching tabs is instant.
  const [activeTab, setActiveTab] = useState<'active' | 'pending' | 'sold' | 'archived' | 'analytics'>('active');
  const [publishedAds, setPublishedAds] = useState<Ad[]>([]);
  const [pendingOrders, setPendingOrders] = useState<SellerOrder[]>([]);
  const [soldAds, setSoldAds] = useState<Ad[]>([]);
  const [archivedAds, setArchivedAds] = useState<Ad[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [completingOrderId, setCompletingOrderId] = useState<number | null>(null);
  const [page, setPage] = useState(1);

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

  // List + pagination for the currently open listings tab.
  const currentAds =
    activeTab === 'active' ? publishedAds : activeTab === 'sold' ? soldAds : archivedAds;
  const totalPages = Math.max(1, Math.ceil(currentAds.length / ADS_PER_PAGE));
  const paginatedAds = currentAds.slice(
    (page - 1) * ADS_PER_PAGE,
    page * ADS_PER_PAGE,
  );

  // Delete a listing (after confirm) and drop it from whichever tab list held it.
  const handleDelete = async (id: number) => {
    if (!confirm('Delete this ad? This cannot be undone.')) return;
    const token = localStorage.getItem('token') || '';
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
      } else {
        const data = await res.json().catch(() => ({})) as { error?: string };
        showToast(data.error || 'Failed to delete ad', 'error');
      }
    } catch {
      showToast('Network error', 'error');
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
    <main className={styles.main}>
      <Header/>

      <div className={styles.container}>
        <button
          className={styles.backBtn}
          onClick={() => router.push('/profile')}
        >
          {t('myShop.back')}
        </button>

        <h1 className={styles.heading}>{t('myShop.heading')}</h1>
        <p className={styles.subheading}>
          {t('myShop.subheading', {
            count: publishedAds.length + soldAds.length + archivedAds.length,
          })}
        </p>

        <div className={styles.card}>
          {/* Tabs */}
          <div className={styles.tabBar}>
            <Link href="/sell" className={styles.postAdBtn}>
              {t('myShop.postAd')}
            </Link>
            <Link href="/profile/my-ads/import" className={styles.docsBtn}>
              {t('myShop.importCsv')}
            </Link>
            <Link href="/profile/developer-api" className={styles.docsBtn}>
              {t('myShop.developerApi')}
            </Link>
            <span className={styles.tabDivider} />
            <button
              className={`${styles.tab} ${activeTab === 'active' ? styles.tabActive : ''}`}
              onClick={() => { setActiveTab('active'); setPage(1); }}
            >
              {t('myShop.tabPublished', { count: publishedAds.length })}
            </button>
            <button
              className={`${styles.tab} ${activeTab === 'pending' ? styles.tabActive : ''}`}
              onClick={() => { setActiveTab('pending'); setPage(1); fetchPendingOrders(); }}
            >
              {t('myShop.tabPending', { count: pendingOrders.length })}
            </button>
            <button
              className={`${styles.tab} ${activeTab === 'sold' ? styles.tabActive : ''}`}
              onClick={() => { setActiveTab('sold'); setPage(1); }}
            >
              {t('myShop.tabSold', { count: soldAds.length })}
            </button>
            <button
              className={`${styles.tab} ${activeTab === 'archived' ? styles.tabActive : ''}`}
              onClick={() => { setActiveTab('archived'); setPage(1); }}
            >
              {t('myShop.tabArchived', { count: archivedAds.length })}
            </button>
            <button
              className={`${styles.tab} ${activeTab === 'analytics' ? styles.tabActive : ''}`}
              onClick={() => setActiveTab('analytics')}
            >
              {t('myShop.tabAnalytics')}
            </button>
          </div>

          {/* Analytics */}
          {activeTab === 'analytics' ? (
            <div className={styles.analyticsSection}>
              {analyticsLoading ? (
                <p className={styles.emptyText}>{t('analytics.loading')}</p>
              ) : (
                <>
                  {/* Overview stat tiles */}
                  <div className={styles.sectionCard}>
                  <h2 className={styles.sectionTitle}>{t('analytics.overview')}</h2>
                  <div className={styles.statGrid}>
                    <div className={styles.statTile}>
                      <p className={styles.statLabel}>{t('analytics.sellThroughRate')}</p>
                      <p className={styles.statValue}>{(summary?.sellThroughRate ?? 0).toFixed(0)}%</p>
                    </div>
                    <div className={styles.statTile}>
                      <p className={styles.statLabel}>{t('analytics.totalRevenue')}</p>
                      <p className={styles.statValue}>RM {(summary?.totalRevenue ?? 0).toFixed(2)}</p>
                    </div>
                    <div className={styles.statTile}>
                      <p className={styles.statLabel}>{t('analytics.activeListings')}</p>
                      <p className={styles.statValue}>{summary?.itemsActive ?? 0}</p>
                    </div>
                    <div className={styles.statTile}>
                      <p className={styles.statLabel}>{t('analytics.pendingOrders')}</p>
                      <p className={styles.statValue}>{summary?.pendingOrders ?? 0}</p>
                    </div>
                    <div className={styles.statTile}>
                      <p className={styles.statLabel}>{t('analytics.itemsSold')}</p>
                      <p className={styles.statValue}>{summary?.itemsSold ?? 0}</p>
                    </div>
                    <div className={styles.statTile}>
                      <p className={styles.statLabel}>{t('analytics.archived')}</p>
                      <p className={styles.statValue}>{summary?.itemsArchived ?? 0}</p>
                    </div>
                    <div className={styles.statTile}>
                      <p className={styles.statLabel}>{t('analytics.avgDaysToSell')}</p>
                      <p className={styles.statValue}>
                        {(summary?.avgDaysToSell ?? 0) > 0 ? (summary!.avgDaysToSell).toFixed(1) : '—'}
                      </p>
                    </div>
                  </div>

                  </div>

                  {/* Sales trends: stacked monthly bar chart with a metric toggle
                      and year / month / category filter chips */}
                  <div className={styles.sectionCard}>
                  <h2 className={styles.sectionTitle}>{t('analytics.salesTrends')}</h2>
                  <div className={styles.chartPanel}>
                    <div className={styles.chartToolbar}>
                      <div className={styles.segmented}>
                        <button
                          className={`${styles.segmentBtn} ${chartMetric === 'revenue' ? styles.segmentBtnActive : ''}`}
                          onClick={() => setChartMetric('revenue')}
                        >
                          {t('analytics.monthlyRevenue')}
                        </button>
                        <button
                          className={`${styles.segmentBtn} ${chartMetric === 'orderCount' ? styles.segmentBtnActive : ''}`}
                          onClick={() => setChartMetric('orderCount')}
                        >
                          {t('analytics.itemsSold')}
                        </button>
                      </div>
                      <button className={styles.exportBtn} onClick={exportChartCsv}>
                        {t('analytics.exportCsv')}
                      </button>
                    </div>

                    <div className={styles.filterRow}>
                      <span className={styles.filterLabel}>{t('analytics.year')}</span>
                      <button
                        className={`${styles.filterChip} ${allYearsOn ? styles.filterChipActive : ''}`}
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
                            className={`${styles.filterChip} ${on ? styles.filterChipOn : styles.filterChipOff}`}
                            onClick={() => toggleInList(setSelectedYears, y, chartYears)}
                          >
                            {y}
                            <span className={styles.chipState}>{on ? '✓' : ''}</span>
                          </button>
                        );
                      })}
                    </div>

                    <div className={styles.filterRow}>
                      <span className={styles.filterLabel}>{t('analytics.month')}</span>
                      <button
                        className={`${styles.filterChip} ${allMonthsOn ? styles.filterChipActive : ''}`}
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
                            className={`${styles.filterChip} ${on ? styles.filterChipOn : styles.filterChipOff}`}
                            onClick={() => toggleInList(setSelectedMonths, m, chartMonthParts)}
                          >
                            {t(`months.${m}`)}
                            <span className={styles.chipState}>{on ? '✓' : ''}</span>
                          </button>
                        );
                      })}
                    </div>

                    <div className={styles.filterRow}>
                      <span className={styles.filterLabel}>{t('analytics.categories')}</span>
                      <button
                        className={`${styles.filterChip} ${allCatsOn ? styles.filterChipActive : ''}`}
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
                            className={`${styles.filterChip} ${on ? styles.filterChipOn : styles.filterChipOff}`}
                            onClick={() => toggleCat(cat)}
                            title={on ? t('analytics.hideCat', { name: cat }) : t('analytics.showCat', { name: cat })}
                          >
                            <span className={styles.chipDot} style={{ background: catColor(cat) }} />
                            {cat}
                            <span className={styles.chipState}>{on ? '✓' : ''}</span>
                          </button>
                        );
                      })}
                    </div>

                    {chartData.length > 0 ? (
                      <div className={styles.chartWrap}>
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
                      <p className={styles.emptyText}>{t('analytics.noChartData')}</p>
                    )}
                  </div>
                  </div>

                  {/* Sales by category — click a row to expand the sold items behind it */}
                  {sortedCategories.length > 0 && (
                    <div className={styles.sectionCard}>
                      <div className={styles.sectionHeader}>
                        <h2 className={styles.sectionTitle}>{t('analytics.salesByCategory')}</h2>
                        <button className={styles.exportBtn} onClick={exportCategoryCsv}>
                          {t('analytics.exportCsv')}
                        </button>
                      </div>
                      <div className={styles.tableWrap}>
                        <table className={styles.statsTable}>
                          <thead>
                            <tr>
                              <th className={styles.sortableTh} onClick={() => toggleCatSort('category')}>
                                {t('analytics.category')}{sortArrow(catSort?.key === 'category', catSort?.dir ?? 1)}
                              </th>
                              <th className={styles.sortableTh} onClick={() => toggleCatSort('itemsSold')}>
                                {t('analytics.itemsSold')}{sortArrow(catSort?.key === 'itemsSold', catSort?.dir ?? 1)}
                              </th>
                              <th className={styles.sortableTh} onClick={() => toggleCatSort('avgDays')}>
                                {t('analytics.avgDaysToSell')}{sortArrow(catSort?.key === 'avgDays', catSort?.dir ?? 1)}
                              </th>
                              <th className={styles.sortableTh} onClick={() => toggleCatSort('revenue')}>
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
                                    className={styles.expandableRow}
                                    onClick={() => toggleExpandCat(cs.category)}
                                  >
                                    <td>
                                      <span className={styles.chevron}>{expanded ? '▾' : '▸'}</span>
                                      <span
                                        className={styles.chipDot}
                                        style={{ background: catColor(cs.category), marginRight: 6 }}
                                      />
                                      {cs.category}
                                    </td>
                                    <td>{cs.itemsSold}</td>
                                    <td>{cs.avgDays > 0 ? cs.avgDays.toFixed(1) : '—'}</td>
                                    <td>RM {cs.revenue.toFixed(2)}</td>
                                  </tr>
                                  {expanded && (
                                    <tr className={styles.detailRow}>
                                      <td colSpan={4}>
                                        {soldInCat.length === 0 ? (
                                          <p className={styles.subEmpty}>
                                            {t('analytics.noSoldInCategory')}
                                          </p>
                                        ) : (
                                          <table className={styles.subTable}>
                                            <thead>
                                              <tr>
                                                <th className={styles.indexCol}>#</th>
                                                <th>{t('analytics.item')}</th>
                                                <th>{t('analytics.soldDate')}</th>
                                                <th>{t('analytics.daysToSell')}</th>
                                                <th>{t('analytics.revenue')}</th>
                                              </tr>
                                            </thead>
                                            <tbody>
                                              {soldInCat.map((it, idx) => (
                                                <tr key={it.listingId}>
                                                  <td className={styles.indexCol}>{idx + 1}</td>
                                                  <td>
                                                    <Link
                                                      href={`/products/${it.listingId}`}
                                                      className={styles.actionLink}
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
                  <div className={styles.sectionCard}>
                  {itemStats.some((it) => it.stale) && (
                    <p className={styles.staleBanner}>
                      {t('analytics.staleBanner', {
                        count: itemStats.filter((it) => it.stale).length,
                      })}
                    </p>
                  )}

                  <div className={styles.sectionHeader}>
                    <h2 className={styles.sectionTitle}>{t('analytics.myItems')}</h2>
                    {itemStats.length > 0 && (
                      <div className={styles.sectionActions}>
                        <button
                          className={`${styles.exportBtn} ${activeFilterCount > 0 ? styles.filterBtnActive : ''}`}
                          onClick={() => setShowItemFilters((s) => !s)}
                        >
                          {t('analytics.filters')}{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
                        </button>
                        <button className={styles.exportBtn} onClick={exportItemsCsv}>
                          {t('analytics.exportCsv')}
                        </button>
                      </div>
                    )}
                  </div>

                  {showItemFilters && itemStats.length > 0 && (
                    <div className={styles.filterPanel}>
                      <div className={styles.filterGrid}>
                        <label className={styles.filterField}>
                          <span className={styles.filterFieldLabel}>{t('analytics.itemName')}</span>
                          <input
                            type="text"
                            className={styles.filterInput}
                            placeholder={t('analytics.searchTitle')}
                            value={itemFilters.search}
                            onChange={(e) =>
                              setItemFilters((f) => ({ ...f, search: e.target.value }))
                            }
                          />
                        </label>
                        <label className={styles.filterField}>
                          <span className={styles.filterFieldLabel}>{t('analytics.priceRm')}</span>
                          <span className={styles.rangePair}>
                            <input
                              type="number"
                              min="0"
                              className={styles.filterInput}
                              placeholder={t('analytics.min')}
                              value={itemFilters.priceMin}
                              onChange={(e) =>
                                setItemFilters((f) => ({ ...f, priceMin: e.target.value.replace(/-/g, '') }))
                              }
                            />
                            <span className={styles.rangeDash}>–</span>
                            <input
                              type="number"
                              min="0"
                              className={styles.filterInput}
                              placeholder={t('analytics.max')}
                              value={itemFilters.priceMax}
                              onChange={(e) =>
                                setItemFilters((f) => ({ ...f, priceMax: e.target.value.replace(/-/g, '') }))
                              }
                            />
                          </span>
                        </label>
                        <label className={styles.filterField}>
                          <span className={styles.filterFieldLabel}>{t('analytics.daysListed')}</span>
                          <span className={styles.rangePair}>
                            <input
                              type="number"
                              min="0"
                              className={styles.filterInput}
                              placeholder={t('analytics.min')}
                              value={itemFilters.daysMin}
                              onChange={(e) =>
                                setItemFilters((f) => ({ ...f, daysMin: e.target.value.replace(/-/g, '') }))
                              }
                            />
                            <span className={styles.rangeDash}>–</span>
                            <input
                              type="number"
                              min="0"
                              className={styles.filterInput}
                              placeholder={t('analytics.max')}
                              value={itemFilters.daysMax}
                              onChange={(e) =>
                                setItemFilters((f) => ({ ...f, daysMax: e.target.value.replace(/-/g, '') }))
                              }
                            />
                          </span>
                        </label>
                        <label className={styles.filterField}>
                          <span className={styles.filterFieldLabel}>{t('analytics.views30d')}</span>
                          <span className={styles.rangePair}>
                            <input
                              type="number"
                              min="0"
                              className={styles.filterInput}
                              placeholder={t('analytics.min')}
                              value={itemFilters.viewsMin}
                              onChange={(e) =>
                                setItemFilters((f) => ({ ...f, viewsMin: e.target.value.replace(/-/g, '') }))
                              }
                            />
                            <span className={styles.rangeDash}>–</span>
                            <input
                              type="number"
                              min="0"
                              className={styles.filterInput}
                              placeholder={t('analytics.max')}
                              value={itemFilters.viewsMax}
                              onChange={(e) =>
                                setItemFilters((f) => ({ ...f, viewsMax: e.target.value.replace(/-/g, '') }))
                              }
                            />
                          </span>
                        </label>
                      </div>
                      <div className={styles.filterRow}>
                        <span className={styles.filterLabel}>{t('analytics.category')}</span>
                        <button
                          className={`${styles.filterChip} ${itemFilters.cats === null || itemFilters.cats.length === itemCategories.length ? styles.filterChipActive : ''}`}
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
                              className={`${styles.filterChip} ${on ? styles.filterChipOn : styles.filterChipOff}`}
                              onClick={() => toggleFilterList('cats', cat, itemCategories)}
                            >
                              {cat}
                              <span className={styles.chipState}>{on ? '✓' : ''}</span>
                            </button>
                          );
                        })}
                      </div>
                      <div className={styles.filterRow}>
                        <span className={styles.filterLabel}>{t('analytics.statusLabel')}</span>
                        <button
                          className={`${styles.filterChip} ${itemFilters.statuses === null || itemFilters.statuses.length === ITEM_STATUSES.length ? styles.filterChipActive : ''}`}
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
                              className={`${styles.filterChip} ${on ? styles.filterChipOn : styles.filterChipOff}`}
                              onClick={() => toggleFilterList('statuses', st, ITEM_STATUSES)}
                            >
                              {t(`status.${st}`)}
                              <span className={styles.chipState}>{on ? '✓' : ''}</span>
                            </button>
                          );
                        })}
                        <span className={styles.filterLabel}>{t('analytics.sold')}</span>
                        {(['all', 'sold', 'unsold'] as const).map((s) => (
                          <button
                            key={s}
                            className={`${styles.filterChip} ${itemFilters.sold === s ? styles.filterChipActive : ''}`}
                            onClick={() => setItemFilters((f) => ({ ...f, sold: s }))}
                          >
                            {s === 'all'
                              ? t('analytics.all')
                              : s === 'sold'
                                ? t('analytics.sold')
                                : t('analytics.notSold')}
                          </button>
                        ))}
                        <button className={styles.clearFiltersBtn} onClick={clearItemFilters}>
                          {t('analytics.clearAll')}
                        </button>
                      </div>
                      <p className={styles.filterResultCount}>
                        {t('analytics.showingCount', {
                          shown: sortedItems.length,
                          total: itemStats.length,
                        })}
                      </p>
                    </div>
                  )}

                  {itemStats.length === 0 ? (
                    <p className={styles.emptyText}>{t('analytics.noListings')}</p>
                  ) : sortedItems.length === 0 ? (
                    <p className={styles.emptyText}>{t('analytics.noMatches')}</p>
                  ) : (
                    <div className={styles.tableWrap}>
                      <table className={styles.statsTable}>
                        <thead>
                          <tr>
                            <th className={styles.indexCol}>#</th>
                            <th className={styles.sortableTh} onClick={() => toggleItemSort('title')}>
                              {t('analytics.item')}{sortArrow(itemSort?.key === 'title', itemSort?.dir ?? 1)}
                            </th>
                            <th className={styles.sortableTh} onClick={() => toggleItemSort('price')}>
                              {t('analytics.price')}{sortArrow(itemSort?.key === 'price', itemSort?.dir ?? 1)}
                            </th>
                            <th className={styles.sortableTh} onClick={() => toggleItemSort('category')}>
                              {t('analytics.category')}{sortArrow(itemSort?.key === 'category', itemSort?.dir ?? 1)}
                            </th>
                            <th className={styles.sortableTh} onClick={() => toggleItemSort('status')}>
                              {t('analytics.statusLabel')}{sortArrow(itemSort?.key === 'status', itemSort?.dir ?? 1)}
                            </th>
                            <th className={styles.sortableTh} onClick={() => toggleItemSort('daysListed')}>
                              {t('analytics.daysListedCol')}{sortArrow(itemSort?.key === 'daysListed', itemSort?.dir ?? 1)}
                            </th>
                            <th className={styles.sortableTh} onClick={() => toggleItemSort('viewsLast30Days')}>
                              {t('analytics.views30d')}{sortArrow(itemSort?.key === 'viewsLast30Days', itemSort?.dir ?? 1)}
                            </th>
                            <th className={styles.sortableTh} onClick={() => toggleItemSort('soldAt')}>
                              {t('analytics.sold')}{sortArrow(itemSort?.key === 'soldAt', itemSort?.dir ?? 1)}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {pagedItems.map((it, idx) => (
                            <tr key={it.listingId} className={it.stale ? styles.staleRow : ''}>
                              <td className={styles.indexCol}>
                                {(clampedItemPage - 1) * ITEMS_PER_PAGE + idx + 1}
                              </td>
                              <td>
                                <Link href={`/products/${it.listingId}`} className={styles.actionLink}>
                                  {it.title}
                                </Link>
                                {it.stale && <span className={styles.staleTag}> {t('analytics.stale')}</span>}
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
                    <div className={styles.pagination}>
                      <button
                        className={styles.pageBtn}
                        disabled={clampedItemPage === 1}
                        onClick={() => setItemPage((p) => Math.max(1, p - 1))}
                      >
                        ‹
                      </button>
                      {Array.from({ length: itemTotalPages }, (_, i) => (
                        <button
                          key={i + 1}
                          className={`${styles.pageBtn} ${clampedItemPage === i + 1 ? styles.pageBtnActive : ''}`}
                          onClick={() => setItemPage(i + 1)}
                        >
                          {i + 1}
                        </button>
                      ))}
                      <button
                        className={styles.pageBtn}
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
              <p className={styles.emptyText}>Loading pending orders…</p>
            ) : pendingOrders.length === 0 ? (
              <div className={styles.emptyState}>
                <p className={styles.emptyText}>No pending orders to deliver.</p>
              </div>
            ) : (
              <div className={styles.pendingList}>
                {pendingOrders.map((order, i) => (
                  <div key={order.id} className={styles.pendingOrderItem}>
                    <span className={styles.adIndex}>{i + 1}</span>
                    <div className={styles.adImageWrap}>
                      <img
                        src={orderImgSrc(order)}
                        alt={order.listingTitle}
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = PLACEHOLDER_IMAGE;
                        }}
                      />
                    </div>
                    <div className={styles.adInfo}>
                      <p className={styles.adPrice}>RM {order.totalPrice.toFixed(2)}</p>
                      <Link href={`/products/${order.listingId}`} className={styles.adTitle}>
                        {order.listingTitle}
                      </Link>
                      <p className={styles.adMeta}>
                        Buyer: {order.buyerUsername || order.buyerEmail || 'Buyer'}
                      </p>
                      <p className={styles.adViews}>
                        Ordered {formatDate(order.createdAt)} · Qty {order.quantity} · {order.paymentMethod || 'meetup'}
                      </p>
                    </div>
                    <div className={styles.adSide}>
                      <span className={`${styles.statusChip} ${styles.statusPending}`}>
                        Pending
                      </span>
                      <button
                        className={styles.completeOrderBtn}
                        onClick={() => handleCompleteOrder(order.id)}
                        disabled={completingOrderId === order.id}
                      >
                        {completingOrderId === order.id ? 'Saving…' : 'Mark as Delivered'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : loading ? (
            <p className={styles.emptyText}>{t('myShop.loadingAds')}</p>
          ) : paginatedAds.length === 0 ? (
            <div className={styles.emptyState}>
              <p className={styles.emptyText}>
                {activeTab === 'active'
                  ? t('myShop.emptyPublished')
                  : activeTab === 'sold'
                    ? t('myShop.emptySold')
                    : t('myShop.emptyArchived')}
              </p>
              {activeTab === 'active' && (
                <Link href="/sell" className={styles.postAdLink}>
                  {t('myShop.postFirstAd')}
                </Link>
              )}
            </div>
          ) : (
            /* Active / Sold / Archived listings of the open tab */
            paginatedAds.map((ad, i) => (
              <div key={ad.id} className={styles.adItem}>
                <span className={styles.adIndex}>
                  {(page - 1) * ADS_PER_PAGE + i + 1}
                </span>
                <div className={styles.adImageWrap}>
                  <img
                    src={imgSrc(ad)}
                    alt={ad.title}
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = PLACEHOLDER_IMAGE;
                    }}
                  />
                </div>
                <div className={styles.adInfo}>
                  <p className={styles.adPrice}>RM {ad.price.toFixed(2)}</p>
                  <Link href={`/products/${ad.id}`} className={styles.adTitle}>
                    {ad.title}
                  </Link>
                  <p className={styles.adMeta}>
                    Posted {formatDate(ad.createdAt)} · {ad.location}
                  </p>
                  <p className={styles.adViews}>
                    👁 {ad.viewsCount} views in the last 30 days
                  </p>
                </div>
                <div className={styles.adSide}>
                  <span
                    className={`${styles.statusChip} ${
                      ad.status === 'active'
                        ? styles.statusActive
                        : ad.status === 'sold'
                          ? styles.statusSold
                          : styles.statusArchived
                    }`}
                  >
                    {ad.status === 'active' ? 'Published' : ad.status}
                  </span>
                  <span className={styles.adDays}>
                    {daysSince(ad.createdAt)} days listed
                  </span>
                  <div className={styles.adActions}>
                    <Link
                      href={`/sell?editId=${ad.id}`}
                      className={styles.actionLink}
                    >
                      Edit
                    </Link>
                    <span className={styles.actionDivider}>|</span>
                    <button
                      className={styles.actionDeleteBtn}
                      onClick={() => handleDelete(ad.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}

          {/* Pagination */}
          {activeTab !== 'analytics' && !loading && totalPages > 1 && (
            <div className={styles.pagination}>
              <button
                className={styles.pageBtn}
                disabled={page === 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                ‹
              </button>
              {Array.from({ length: totalPages }, (_, i) => (
                <button
                  key={i + 1}
                  className={`${styles.pageBtn} ${page === i + 1 ? styles.pageBtnActive : ''}`}
                  onClick={() => setPage(i + 1)}
                >
                  {i + 1}
                </button>
              ))}
              <button
                className={styles.pageBtn}
                disabled={page === totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                ›
              </button>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

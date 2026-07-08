'use client';

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
import Header from '@/components/Header/Header';
import styles from './my-ads.module.css';

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

interface SellerMonthlyStat {
  month: string;
  orderCount: number;
  revenue: number;
}

interface CategoryStat {
  category: string;
  itemsSold: number;
  revenue: number;
}

interface MonthlyCategoryStat {
  month: string;
  category: string;
  orderCount: number;
  revenue: number;
}

interface SellerSummary {
  totalRevenue: number;
  itemsSold: number;
  itemsActive: number;
  itemsArchived: number;
  sellThroughRate: number;
  avgDaysToSell: number;
  monthlyRevenue: SellerMonthlyStat[];
  monthlyByCategory: MonthlyCategoryStat[];
  categoryBreakdown: CategoryStat[];
}

type ItemSortKey = 'title' | 'price' | 'category' | 'status' | 'daysListed' | 'viewsLast30Days' | 'soldAt';
type CategorySortKey = 'category' | 'itemsSold' | 'revenue' | 'avgDays';

const MONTH_NAMES: Record<string, string> = {
  '01': 'Jan', '02': 'Feb', '03': 'Mar', '04': 'Apr', '05': 'May', '06': 'Jun',
  '07': 'Jul', '08': 'Aug', '09': 'Sep', '10': 'Oct', '11': 'Nov', '12': 'Dec',
};
type ChartMetric = 'revenue' | 'orderCount';

const csvEscape = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const downloadCsv = (filename: string, header: string[], rows: (string | number)[][]) => {
  const csv = [header, ...rows].map((r) => r.map(csvEscape).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

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

//   const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'active' | 'pending' | 'sold' | 'archived' | 'analytics'>('active');
  const [publishedAds, setPublishedAds] = useState<Ad[]>([]);
  const [pendingOrders, setPendingOrders] = useState<SellerOrder[]>([]);
  const [soldAds, setSoldAds] = useState<Ad[]>([]);
  const [archivedAds, setArchivedAds] = useState<Ad[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [completingOrderId, setCompletingOrderId] = useState<number | null>(null);
  const [page, setPage] = useState(1);

  const [itemStats, setItemStats] = useState<SellerItemStat[]>([]);
  const [summary, setSummary] = useState<SellerSummary | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsLoaded, setAnalyticsLoaded] = useState(false);
  const [itemSort, setItemSort] = useState<{ key: ItemSortKey; dir: 1 | -1 } | null>(null);
  const [catSort, setCatSort] = useState<{ key: CategorySortKey; dir: 1 | -1 } | null>(null);

  const toggleItemSort = (key: ItemSortKey) =>
    setItemSort((s) => (s?.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));
  const toggleCatSort = (key: CategorySortKey) =>
    setCatSort((s) => (s?.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));

  const sortArrow = (active: boolean, dir: 1 | -1) => (active ? (dir === 1 ? ' ▲' : ' ▼') : '');

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

  const itemCategories = useMemo(
    () => Array.from(new Set(itemStats.map((it) => it.category))).sort(),
    [itemStats],
  );
  const ITEM_STATUSES = ['active', 'sold', 'archived'];

  const toggleFilterList = (field: 'cats' | 'statuses', value: string, full: string[]) =>
    setItemFilters((f) => {
      const base = f[field] ?? full;
      const next = base.includes(value)
        ? base.filter((v) => v !== value)
        : [...base, value];
      return { ...f, [field]: next };
    });

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

  const inRange = (v: number, min: string, max: string) => {
    const lo = parseFloat(min);
    const hi = parseFloat(max);
    if (!Number.isNaN(lo) && v < lo) return false;
    if (!Number.isNaN(hi) && v > hi) return false;
    return true;
  };

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

  const itemTotalPages = Math.max(1, Math.ceil(sortedItems.length / ITEMS_PER_PAGE));
  const clampedItemPage = Math.min(itemPage, itemTotalPages);
  const pagedItems = sortedItems.slice(
    (clampedItemPage - 1) * ITEMS_PER_PAGE,
    clampedItemPage * ITEMS_PER_PAGE,
  );

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

  const exportChartCsv = () =>
    downloadCsv(
      'seller-monthly-sales.csv',
      ['month', 'category', 'itemsSold', 'revenue'],
      filteredChartRows.map((r) => [r.month, r.category, r.orderCount, r.revenue]),
    );

  const exportItemsCsv = () =>
    downloadCsv(
      'seller-items.csv',
      ['item', 'category', 'price', 'status', 'daysListed', 'views30d', 'sold', 'soldAt', 'revenue'],
      sortedItems.map((it) => [
        it.title, it.category, it.price, it.status, it.daysListed,
        it.viewsLast30Days, it.sold ? 'yes' : 'no', it.soldAt ?? '', it.revenue,
      ]),
    );

//   const handleSearch = () => {
//     router.push(`/?search=${encodeURIComponent(searchQuery)}`);
//   };

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

  const currentAds =
    activeTab === 'active' ? publishedAds : activeTab === 'sold' ? soldAds : archivedAds;
  const totalPages = Math.max(1, Math.ceil(currentAds.length / ADS_PER_PAGE));
  const paginatedAds = currentAds.slice(
    (page - 1) * ADS_PER_PAGE,
    page * ADS_PER_PAGE,
  );

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

  const daysSince = (str: string) => {
    const d = new Date(str).getTime();
    if (Number.isNaN(d)) return 0;
    return Math.max(0, Math.floor((Date.now() - d) / 86400000));
  };

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
          ← Back
        </button>

        <h1 className={styles.heading}>🏪 My Shop</h1>
        <p className={styles.subheading}>
          {publishedAds.length + soldAds.length + archivedAds.length} listings · manage your
          items and track your sales
        </p>

        <div className={styles.card}>
          {/* Tabs */}
          <div className={styles.tabBar}>
            <Link href="/sell" className={styles.postAdBtn}>
              + Post an Ad
            </Link>
            <Link href="/profile/developer-api" className={styles.docsBtn}>
              Developer API
            </Link>
            <span className={styles.tabDivider} />
            <button
              className={`${styles.tab} ${activeTab === 'active' ? styles.tabActive : ''}`}
              onClick={() => { setActiveTab('active'); setPage(1); }}
            >
              Published ({publishedAds.length})
            </button>
            <button
              className={`${styles.tab} ${activeTab === 'pending' ? styles.tabActive : ''}`}
              onClick={() => { setActiveTab('pending'); setPage(1); fetchPendingOrders(); }}
            >
              Pending Orders ({pendingOrders.length})
            </button>
            <button
              className={`${styles.tab} ${activeTab === 'sold' ? styles.tabActive : ''}`}
              onClick={() => { setActiveTab('sold'); setPage(1); }}
            >
              Sold ({soldAds.length})
            </button>
            <button
              className={`${styles.tab} ${activeTab === 'archived' ? styles.tabActive : ''}`}
              onClick={() => { setActiveTab('archived'); setPage(1); }}
            >
              Archived ({archivedAds.length})
            </button>
            <button
              className={`${styles.tab} ${activeTab === 'analytics' ? styles.tabActive : ''}`}
              onClick={() => setActiveTab('analytics')}
            >
              📊 Analytics
            </button>
          </div>

          {/* Analytics */}
          {activeTab === 'analytics' ? (
            <div className={styles.analyticsSection}>
              {analyticsLoading ? (
                <p className={styles.emptyText}>Loading analytics…</p>
              ) : (
                <>
                  <div className={styles.sectionCard}>
                  <h2 className={styles.sectionTitle}>🏪 Overview</h2>
                  <div className={styles.statGrid}>
                    <div className={styles.statTile}>
                      <p className={styles.statLabel}>Sell-Through Rate</p>
                      <p className={styles.statValue}>{(summary?.sellThroughRate ?? 0).toFixed(0)}%</p>
                    </div>
                    <div className={styles.statTile}>
                      <p className={styles.statLabel}>Total Revenue</p>
                      <p className={styles.statValue}>RM {(summary?.totalRevenue ?? 0).toFixed(2)}</p>
                    </div>
                    <div className={styles.statTile}>
                      <p className={styles.statLabel}>Items Sold</p>
                      <p className={styles.statValue}>{summary?.itemsSold ?? 0}</p>
                    </div>
                    <div className={styles.statTile}>
                      <p className={styles.statLabel}>Active Listings</p>
                      <p className={styles.statValue}>{summary?.itemsActive ?? 0}</p>
                    </div>
                    <div className={styles.statTile}>
                      <p className={styles.statLabel}>Archived</p>
                      <p className={styles.statValue}>{summary?.itemsArchived ?? 0}</p>
                    </div>
                    <div className={styles.statTile}>
                      <p className={styles.statLabel}>Avg Days to Sell</p>
                      <p className={styles.statValue}>
                        {(summary?.avgDaysToSell ?? 0) > 0 ? (summary!.avgDaysToSell).toFixed(1) : '—'}
                      </p>
                    </div>
                  </div>

                  </div>

                  <div className={styles.sectionCard}>
                  <h2 className={styles.sectionTitle}>📈 Sales Trends</h2>
                  <div className={styles.chartPanel}>
                    <div className={styles.chartToolbar}>
                      <div className={styles.segmented}>
                        <button
                          className={`${styles.segmentBtn} ${chartMetric === 'revenue' ? styles.segmentBtnActive : ''}`}
                          onClick={() => setChartMetric('revenue')}
                        >
                          Monthly Revenue
                        </button>
                        <button
                          className={`${styles.segmentBtn} ${chartMetric === 'orderCount' ? styles.segmentBtnActive : ''}`}
                          onClick={() => setChartMetric('orderCount')}
                        >
                          Items Sold
                        </button>
                      </div>
                      <button className={styles.exportBtn} onClick={exportChartCsv}>
                        ⬇ Export CSV
                      </button>
                    </div>

                    <div className={styles.filterRow}>
                      <span className={styles.filterLabel}>Year</span>
                      <button
                        className={`${styles.filterChip} ${allYearsOn ? styles.filterChipActive : ''}`}
                        onClick={() => setSelectedYears(allYearsOn ? [] : null)}
                        title={allYearsOn ? 'Deselect all years' : 'Select all years'}
                      >
                        All
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
                      <span className={styles.filterLabel}>Month</span>
                      <button
                        className={`${styles.filterChip} ${allMonthsOn ? styles.filterChipActive : ''}`}
                        onClick={() => setSelectedMonths(allMonthsOn ? [] : null)}
                        title={allMonthsOn ? 'Deselect all months' : 'Select all months'}
                      >
                        All
                      </button>
                      {chartMonthParts.map((m) => {
                        const on = activeMonths.includes(m);
                        return (
                          <button
                            key={m}
                            className={`${styles.filterChip} ${on ? styles.filterChipOn : styles.filterChipOff}`}
                            onClick={() => toggleInList(setSelectedMonths, m, chartMonthParts)}
                          >
                            {MONTH_NAMES[m] ?? m}
                            <span className={styles.chipState}>{on ? '✓' : ''}</span>
                          </button>
                        );
                      })}
                    </div>

                    <div className={styles.filterRow}>
                      <span className={styles.filterLabel}>Categories</span>
                      <button
                        className={`${styles.filterChip} ${allCatsOn ? styles.filterChipActive : ''}`}
                        onClick={() => setSelectedCats(allCatsOn ? [] : null)}
                        title={allCatsOn ? 'Deselect all categories' : 'Select all categories'}
                      >
                        All
                      </button>
                      {chartCategories.map((cat) => {
                        const on = activeCats.includes(cat);
                        return (
                          <button
                            key={cat}
                            className={`${styles.filterChip} ${on ? styles.filterChipOn : styles.filterChipOff}`}
                            onClick={() => toggleCat(cat)}
                            title={on ? `Hide ${cat}` : `Show ${cat}`}
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
                            <XAxis dataKey="month" tick={{ fill: '#898781', fontSize: 12 }} />
                            <YAxis
                              allowDecimals={chartMetric === 'revenue'}
                              tick={{ fill: '#898781', fontSize: 12 }}
                            />
                            <Tooltip
                              formatter={(value, name) => {
                                const n = Number(Array.isArray(value) ? value[0] : value ?? 0);
                                return [
                                  chartMetric === 'revenue' ? `RM ${n.toFixed(2)}` : `${n} item(s)`,
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
                      <p className={styles.emptyText}>No sales data for this selection.</p>
                    )}
                  </div>
                  </div>

                  {sortedCategories.length > 0 && (
                    <div className={styles.sectionCard}>
                      <div className={styles.sectionHeader}>
                        <h2 className={styles.sectionTitle}>🗂 Sales by Category</h2>
                        <button className={styles.exportBtn} onClick={exportCategoryCsv}>
                          ⬇ Export CSV
                        </button>
                      </div>
                      <div className={styles.tableWrap}>
                        <table className={styles.statsTable}>
                          <thead>
                            <tr>
                              <th className={styles.sortableTh} onClick={() => toggleCatSort('category')}>
                                Category{sortArrow(catSort?.key === 'category', catSort?.dir ?? 1)}
                              </th>
                              <th className={styles.sortableTh} onClick={() => toggleCatSort('itemsSold')}>
                                Items Sold{sortArrow(catSort?.key === 'itemsSold', catSort?.dir ?? 1)}
                              </th>
                              <th className={styles.sortableTh} onClick={() => toggleCatSort('avgDays')}>
                                Avg Days to Sell{sortArrow(catSort?.key === 'avgDays', catSort?.dir ?? 1)}
                              </th>
                              <th className={styles.sortableTh} onClick={() => toggleCatSort('revenue')}>
                                Total Revenue{sortArrow(catSort?.key === 'revenue', catSort?.dir ?? 1)}
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
                                            No sold items found for this category.
                                          </p>
                                        ) : (
                                          <table className={styles.subTable}>
                                            <thead>
                                              <tr>
                                                <th className={styles.indexCol}>#</th>
                                                <th>Item</th>
                                                <th>Sold Date</th>
                                                <th>Days to Sell</th>
                                                <th>Revenue</th>
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

                  <div className={styles.sectionCard}>
                  {itemStats.some((it) => it.stale) && (
                    <p className={styles.staleBanner}>
                      ⚠ {itemStats.filter((it) => it.stale).length} listing
                      {itemStats.filter((it) => it.stale).length > 1 ? 's have' : ' has'} been active
                      for 30+ days without selling — consider repricing or updating photos.
                    </p>
                  )}

                  <div className={styles.sectionHeader}>
                    <h2 className={styles.sectionTitle}>📦 My Items</h2>
                    {itemStats.length > 0 && (
                      <div className={styles.sectionActions}>
                        <button
                          className={`${styles.exportBtn} ${activeFilterCount > 0 ? styles.filterBtnActive : ''}`}
                          onClick={() => setShowItemFilters((s) => !s)}
                        >
                          ⚙ Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
                        </button>
                        <button className={styles.exportBtn} onClick={exportItemsCsv}>
                          ⬇ Export CSV
                        </button>
                      </div>
                    )}
                  </div>

                  {showItemFilters && itemStats.length > 0 && (
                    <div className={styles.filterPanel}>
                      <div className={styles.filterGrid}>
                        <label className={styles.filterField}>
                          <span className={styles.filterFieldLabel}>Item name</span>
                          <input
                            type="text"
                            className={styles.filterInput}
                            placeholder="Search title…"
                            value={itemFilters.search}
                            onChange={(e) =>
                              setItemFilters((f) => ({ ...f, search: e.target.value }))
                            }
                          />
                        </label>
                        <label className={styles.filterField}>
                          <span className={styles.filterFieldLabel}>Price (RM)</span>
                          <span className={styles.rangePair}>
                            <input
                              type="number"
                              min="0"
                              className={styles.filterInput}
                              placeholder="Min"
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
                              placeholder="Max"
                              value={itemFilters.priceMax}
                              onChange={(e) =>
                                setItemFilters((f) => ({ ...f, priceMax: e.target.value.replace(/-/g, '') }))
                              }
                            />
                          </span>
                        </label>
                        <label className={styles.filterField}>
                          <span className={styles.filterFieldLabel}>Days listed</span>
                          <span className={styles.rangePair}>
                            <input
                              type="number"
                              min="0"
                              className={styles.filterInput}
                              placeholder="Min"
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
                              placeholder="Max"
                              value={itemFilters.daysMax}
                              onChange={(e) =>
                                setItemFilters((f) => ({ ...f, daysMax: e.target.value.replace(/-/g, '') }))
                              }
                            />
                          </span>
                        </label>
                        <label className={styles.filterField}>
                          <span className={styles.filterFieldLabel}>Views (30d)</span>
                          <span className={styles.rangePair}>
                            <input
                              type="number"
                              min="0"
                              className={styles.filterInput}
                              placeholder="Min"
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
                              placeholder="Max"
                              value={itemFilters.viewsMax}
                              onChange={(e) =>
                                setItemFilters((f) => ({ ...f, viewsMax: e.target.value.replace(/-/g, '') }))
                              }
                            />
                          </span>
                        </label>
                      </div>
                      <div className={styles.filterRow}>
                        <span className={styles.filterLabel}>Category</span>
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
                          All
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
                        <span className={styles.filterLabel}>Status</span>
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
                          All
                        </button>
                        {ITEM_STATUSES.map((st) => {
                          const on = (itemFilters.statuses ?? ITEM_STATUSES).includes(st);
                          return (
                            <button
                              key={st}
                              className={`${styles.filterChip} ${on ? styles.filterChipOn : styles.filterChipOff}`}
                              onClick={() => toggleFilterList('statuses', st, ITEM_STATUSES)}
                            >
                              {st}
                              <span className={styles.chipState}>{on ? '✓' : ''}</span>
                            </button>
                          );
                        })}
                        <span className={styles.filterLabel}>Sold</span>
                        {(['all', 'sold', 'unsold'] as const).map((s) => (
                          <button
                            key={s}
                            className={`${styles.filterChip} ${itemFilters.sold === s ? styles.filterChipActive : ''}`}
                            onClick={() => setItemFilters((f) => ({ ...f, sold: s }))}
                          >
                            {s === 'all' ? 'All' : s === 'sold' ? 'Sold' : 'Not sold'}
                          </button>
                        ))}
                        <button className={styles.clearFiltersBtn} onClick={clearItemFilters}>
                          ✕ Clear all
                        </button>
                      </div>
                      <p className={styles.filterResultCount}>
                        Showing {sortedItems.length} of {itemStats.length} items
                      </p>
                    </div>
                  )}

                  {itemStats.length === 0 ? (
                    <p className={styles.emptyText}>No listings yet.</p>
                  ) : sortedItems.length === 0 ? (
                    <p className={styles.emptyText}>No items match the current filters.</p>
                  ) : (
                    <div className={styles.tableWrap}>
                      <table className={styles.statsTable}>
                        <thead>
                          <tr>
                            <th className={styles.indexCol}>#</th>
                            <th className={styles.sortableTh} onClick={() => toggleItemSort('title')}>
                              Item{sortArrow(itemSort?.key === 'title', itemSort?.dir ?? 1)}
                            </th>
                            <th className={styles.sortableTh} onClick={() => toggleItemSort('price')}>
                              Price{sortArrow(itemSort?.key === 'price', itemSort?.dir ?? 1)}
                            </th>
                            <th className={styles.sortableTh} onClick={() => toggleItemSort('category')}>
                              Category{sortArrow(itemSort?.key === 'category', itemSort?.dir ?? 1)}
                            </th>
                            <th className={styles.sortableTh} onClick={() => toggleItemSort('status')}>
                              Status{sortArrow(itemSort?.key === 'status', itemSort?.dir ?? 1)}
                            </th>
                            <th className={styles.sortableTh} onClick={() => toggleItemSort('daysListed')}>
                              Days Listed{sortArrow(itemSort?.key === 'daysListed', itemSort?.dir ?? 1)}
                            </th>
                            <th className={styles.sortableTh} onClick={() => toggleItemSort('viewsLast30Days')}>
                              Views (30d){sortArrow(itemSort?.key === 'viewsLast30Days', itemSort?.dir ?? 1)}
                            </th>
                            <th className={styles.sortableTh} onClick={() => toggleItemSort('soldAt')}>
                              Sold{sortArrow(itemSort?.key === 'soldAt', itemSort?.dir ?? 1)}
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
                                {it.stale && <span className={styles.staleTag}> stale</span>}
                              </td>
                              <td>RM {it.price.toFixed(2)}</td>
                              <td>{it.category}</td>
                              <td>{it.status}</td>
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
            <p className={styles.emptyText}>Loading your ads…</p>
          ) : paginatedAds.length === 0 ? (
            <div className={styles.emptyState}>
              <p className={styles.emptyText}>
                {activeTab === 'active'
                  ? "You don't have any published ads yet."
                  : activeTab === 'sold'
                    ? "You don't have any sold items yet."
                    : "You don't have any archived items yet."}
              </p>
              {activeTab === 'active' && (
                <Link href="/sell" className={styles.postAdLink}>
                  Post your first ad →
                </Link>
              )}
            </div>
          ) : (
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

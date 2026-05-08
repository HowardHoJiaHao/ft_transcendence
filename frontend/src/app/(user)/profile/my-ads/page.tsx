'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/modules/user/components/AuthContext';
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

const ADS_PER_PAGE = 5;
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8080';
const PLACEHOLDER_IMAGE = 'https://via.placeholder.com/350x450';

export default function MyAdsPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { showToast } = useToast();

//   const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'active' | 'sold'>('active');
  const [publishedAds, setPublishedAds] = useState<Ad[]>([]);
  const [soldAds, setSoldAds] = useState<Ad[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

//   const handleSearch = () => {
//     router.push(`/?search=${encodeURIComponent(searchQuery)}`);
//   };

  useEffect(() => {
    if (!user) {
      router.push('/login');
      return;
    }
    setLoading(true);
    Promise.all([
      fetch(
        `${API_BASE}/api/v1/products?sellerId=${user.id}&status=active&limit=100`,
      ).then((r) => r.json()),
      fetch(
        `${API_BASE}/api/v1/products?sellerId=${user.id}&status=sold&limit=100`,
      ).then((r) => r.json()),
    ])
      .then(([activeData, soldData]) => {
        setPublishedAds(activeData.products || []);
        setSoldAds(soldData.products || []);
      })
      .catch(() => showToast('Failed to load your ads', 'error'))
      .finally(() => setLoading(false));
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentAds = activeTab === 'active' ? publishedAds : soldAds;
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

  const imgSrc = (ad: Ad) => {
    if (!ad.image) return PLACEHOLDER_IMAGE;
    if (ad.image.startsWith('http://') || ad.image.startsWith('https://') || ad.image.startsWith('data:'))
      return ad.image;
    if (ad.image.startsWith('/')) return `${API_BASE}${ad.image}`;
    return `${API_BASE}/${ad.image}`;
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

        <h1 className={styles.heading}>
          My Ads ({publishedAds.length + soldAds.length})
        </h1>

        <div className={styles.card}>
          {/* Tabs */}
          <div className={styles.tabBar}>
            <button
              className={`${styles.tab} ${activeTab === 'active' ? styles.tabActive : ''}`}
              onClick={() => { setActiveTab('active'); setPage(1); }}
            >
              Published ({publishedAds.length})
            </button>
            <button
              className={`${styles.tab} ${activeTab === 'sold' ? styles.tabActive : ''}`}
              onClick={() => { setActiveTab('sold'); setPage(1); }}
            >
              Sold ({soldAds.length})
            </button>
          </div>

          {/* Ad list */}
          {loading ? (
            <p className={styles.emptyText}>Loading your ads…</p>
          ) : paginatedAds.length === 0 ? (
            <div className={styles.emptyState}>
              <p className={styles.emptyText}>
                {activeTab === 'active'
                  ? "You don't have any published ads yet."
                  : "You don't have any sold items yet."}
              </p>
              {activeTab === 'active' && (
                <Link href="/sell" className={styles.postAdLink}>
                  Post your first ad →
                </Link>
              )}
            </div>
          ) : (
            paginatedAds.map((ad) => (
              <div key={ad.id} className={styles.adItem}>
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
                    {formatDate(ad.createdAt)}, {ad.location}
                  </p>
                  <p className={styles.adViews}>
                    👁 {ad.viewsCount} views in the last 30 days
                  </p>
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
          {!loading && totalPages > 1 && (
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

'use client';

// Fetches the four tallies the My Shop row shows, in one request.
// GET /seller/dashboard/summary already returns itemsActive / pendingOrders /
// itemsSold / itemsArchived, so Post an Ad and Developer API can render the
// same badges as My Shop without repeating its four listing fetches.
//
// My Shop itself does NOT use this — it already holds the real arrays and
// passes their lengths straight in.

import { useEffect, useState } from 'react';
import type { ShopTabCounts } from './ShopTabs';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || '';

export function useShopCounts(): ShopTabCounts | null {
  const [counts, setCounts] = useState<ShopTabCounts | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('token') || '';
    if (!token) return;

    let cancelled = false;
    fetch(`${API_BASE}/api/v1/seller/dashboard/summary`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setCounts({
          active: data.itemsActive ?? 0,
          pending: data.pendingOrders ?? 0,
          sold: data.itemsSold ?? 0,
          archived: data.itemsArchived ?? 0,
        });
      })
      // Badges are chrome — a failure here shouldn't interrupt the page.
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  return counts;
}

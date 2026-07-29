'use client';

// Shared "My Shop" navigation row.
// Rendered on My Shop, Post an Ad and Developer API so the row stays visible
// wherever the seller is, instead of disappearing when they leave My Shop.
//
// On My Shop the listing tabs switch in place — the page passes onSelect and
// the tallies it already fetched. On the other pages there are no tallies to
// show, so the tabs render plain labels and link back to
// /profile/my-ads?tab=<id>, which My Shop reads on mount.

import Link from 'next/link';
import { useI18n } from '@/context/LanguageContext';

export type ShopListTab = 'active' | 'pending' | 'sold' | 'archived' | 'analytics';
export type ShopSection = ShopListTab | 'sell' | 'developer-api';

export interface ShopTabCounts {
  active: number;
  pending: number;
  sold: number;
  archived: number;
}

interface ShopTabsProps {
  current: ShopSection;
  counts?: ShopTabCounts;
  onSelect?: (tab: ShopListTab) => void;
}

const LIST_TABS: ShopListTab[] = ['active', 'pending', 'sold', 'archived', 'analytics'];

const PILL =
  'inline-flex items-center px-5 py-2 rounded-[20px] border text-sm no-underline cursor-pointer transition-all duration-150';
const PILL_ON = 'bg-[#fce4ec] border-[#f48fb1] text-[#c2185b] font-bold';
const PILL_OFF = 'bg-white border-[#ccc] text-[#444] font-medium hover:border-[#888]';

export default function ShopTabs({ current, counts, onSelect }: ShopTabsProps) {
  const { t } = useI18n();

  // With counts (My Shop) the labels carry the tally; elsewhere just the name.
  const label = (tab: ShopListTab) => {
    if (tab === 'analytics') return t('myShop.tabAnalytics');
    if (!counts) {
      return {
        active: t('myShop.tabPublishedPlain'),
        pending: t('myShop.tabPendingPlain'),
        sold: t('myShop.tabSoldPlain'),
        archived: t('myShop.tabArchivedPlain'),
      }[tab];
    }
    return {
      active: t('myShop.tabPublished', { count: counts.active }),
      pending: t('myShop.tabPending', { count: counts.pending }),
      sold: t('myShop.tabSold', { count: counts.sold }),
      archived: t('myShop.tabArchived', { count: counts.archived }),
    }[tab];
  };

  return (
    <div className="flex gap-2.5 px-5 py-4 border-b border-[#eee] flex-wrap">
      <Link
        href="/sell"
        className={`inline-flex items-center px-[18px] py-2 rounded-[20px] text-white text-sm font-semibold no-underline transition-colors duration-150 ${
          current === 'sell' ? 'bg-[#333] ring-2 ring-[#111] ring-offset-1' : 'bg-[#111] hover:bg-[#333]'
        }`}
      >
        {t('myShop.postAd')}
      </Link>
      <Link
        href="/profile/developer-api"
        className={`inline-flex items-center px-[18px] py-2 rounded-[20px] text-sm font-bold no-underline transition-colors duration-150 ${
          current === 'developer-api'
            ? 'bg-[#c7d2fe] text-[#312e81] ring-2 ring-[#818cf8] ring-offset-1'
            : 'bg-[#eef2ff] text-[#3730a3] hover:bg-[#e0e7ff]'
        }`}
      >
        {t('myShop.developerApi')}
      </Link>

      <span className="w-px self-stretch bg-[#e5e5e2] my-0 mx-1" />

      {LIST_TABS.map((tab) =>
        onSelect ? (
          <button
            key={tab}
            type="button"
            className={`${PILL} ${current === tab ? PILL_ON : PILL_OFF}`}
            onClick={() => onSelect(tab)}
          >
            {label(tab)}
          </button>
        ) : (
          <Link
            key={tab}
            href={`/profile/my-ads?tab=${tab}`}
            className={`${PILL} ${current === tab ? PILL_ON : PILL_OFF}`}
          >
            {label(tab)}
          </Link>
        ),
      )}
    </div>
  );
}

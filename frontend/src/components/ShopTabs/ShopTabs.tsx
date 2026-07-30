'use client';

// Shared "My Shop" navigation row.
// Rendered on My Shop and Post an Ad so the row stays visible wherever the
// seller is, instead of disappearing when they leave My Shop. Developer API is
// reached from the profile menu in the site header and shows no row at all.
//
// Layout: the listing states (Published … Archived) sit on the left, while
// Analytics and Post an Ad are pushed to the right — Post an Ad last. All of
// them share the pill's selected treatment, so the current page is obvious
// whichever one you are on.
//
// On My Shop the listing tabs switch in place — the page passes onSelect and
// the tallies it already fetched. On Post an Ad there are no tallies to show,
// so the tabs render plain labels and link back to /profile/my-ads?tab=<id>,
// which My Shop reads on mount.

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

// Left group. Analytics is a listing tab too, but renders in the right group.
const LIST_TABS: ShopListTab[] = ['active', 'pending', 'sold', 'archived'];

const PILL =
  'inline-flex items-center px-5 py-2 rounded-[20px] border text-sm no-underline cursor-pointer transition-all duration-150';
const PILL_ON = 'bg-[#fce4ec] border-[#f48fb1] text-[#c2185b] font-bold';
const PILL_OFF = 'bg-white border-[#ccc] text-[#444] font-medium hover:border-[#888]';

// Post an Ad is the row's primary action, so it stays dark while unselected.
// On /sell it takes the same treatment as a selected tab, so "you are here"
// reads identically wherever you are in the row.
const POST_AD_OFF = 'bg-[#111] border-[#111] text-white font-semibold hover:bg-[#333] hover:border-[#333]';

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

  // My Shop switches tabs in place; the other pages link back to it.
  const tabPill = (tab: ShopListTab) =>
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
    );

  return (
    <div className="flex gap-2.5 px-5 py-4 border-b border-[#eee] flex-wrap items-center">
      {LIST_TABS.map(tabPill)}

      {/* ml-auto pushes this pair right; on a wrapped row it simply starts the
          next line, so nothing overlaps on narrow screens. */}
      <div className="ml-auto flex gap-2.5 flex-wrap items-center">
        {tabPill('analytics')}
        <Link
          href="/sell"
          className={`${PILL} ${current === 'sell' ? PILL_ON : POST_AD_OFF}`}
        >
          {t('myShop.postAd')}
        </Link>
      </div>
    </div>
  );
}

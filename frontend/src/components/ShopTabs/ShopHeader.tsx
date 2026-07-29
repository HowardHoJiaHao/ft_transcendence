'use client';

// The "🏪 My Shop" title block — back button, heading and listing tally.
// Rendered above the tab row on My Shop, Post an Ad and Developer API so the
// top of all three pages is identical.

import { useRouter } from 'next/navigation';
import { useI18n } from '@/context/LanguageContext';
import type { ShopTabCounts } from './ShopTabs';

export default function ShopHeader({ counts }: { counts?: ShopTabCounts | null }) {
  const router = useRouter();
  const { t } = useI18n();

  // Sold and archived listings still count towards the seller's total.
  const total = counts ? counts.active + counts.sold + counts.archived : null;

  return (
    <>
      <button
        className="bg-white border border-[#ddd] rounded-[20px] text-[#444] text-[13px] font-semibold cursor-pointer px-4 py-[7px] mb-3.5 inline-flex items-center gap-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition-all duration-150 hover:border-[#888] hover:text-[#111] hover:-translate-x-0.5"
        onClick={() => router.push('/profile')}
        type="button"
      >
        {t('myShop.back')}
      </button>

      <h1 className="text-[26px] font-bold text-[#222] mt-0 mx-0 mb-4">{t('myShop.heading')}</h1>
      {/* Non-breaking space holds the line's height until the counts land. */}
      <p className="text-[#898781] text-sm mt-[-8px] mx-0 mb-[18px]">
        {total === null ? ' ' : t('myShop.subheading', { count: total })}
      </p>
    </>
  );
}

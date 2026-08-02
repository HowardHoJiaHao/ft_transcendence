'use client';

// The seller-area title block — back button, heading and strapline.
// Rendered above the tab row on My Shop and Post an Ad, so the top of both
// pages is identical. Developer API reuses it too, but titles itself after its
// own page rather than My Shop and has no listing tally to report.

import Link from 'next/link';
import { useI18n } from '@/context/LanguageContext';
import type { ShopSection, ShopTabCounts } from './ShopTabs';

interface ShopHeaderProps {
  counts?: ShopTabCounts | null;
  current?: ShopSection;
}

export default function ShopHeader({ counts, current }: ShopHeaderProps) {
  const { t } = useI18n();

  const isDeveloperApi = current === 'developer-api';

  // Sold and archived listings still count towards the seller's total.
  const total = counts ? counts.active + counts.sold + counts.archived : null;

  // A non-breaking space holds the line's height until the counts land, so the
  // page below does not jump once they do.
  const strapline = isDeveloperApi
    ? t('myShop.developerApiSubheading')
    : total === null
      ? ' '
      : t('myShop.subheading', { count: total });

  return (
    <>
      {/* A real link, not a button+router.push: it is a plain navigation, so
          it should middle-click and be interceptable by unsaved-changes
          guards like the one on the sell form. */}
      <Link
        href="/profile"
        className="bg-white border border-[#ddd] rounded-[20px] text-[#444] text-[13px] font-semibold no-underline cursor-pointer px-4 py-[7px] mb-3.5 inline-flex items-center gap-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition-all duration-150 hover:border-[#888] hover:text-[#111] hover:-translate-x-0.5"
      >
        {t('myShop.back')}
      </Link>

      <h1 className="text-[26px] font-bold text-[#222] mt-0 mx-0 mb-4">
        {isDeveloperApi ? t('myShop.developerApiHeading') : t('myShop.heading')}
      </h1>
      <p className="text-[#898781] text-sm mt-[-8px] mx-0 mb-[18px]">{strapline}</p>
    </>
  );
}

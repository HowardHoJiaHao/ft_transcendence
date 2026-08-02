'use client';

// Standalone bulk-import route. The importer itself lives in
// components/BulkImport so Post an Ad can host the same UI in its
// "Bulk upload" mode; this page only adds the chrome around it.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useI18n } from '@/context/LanguageContext';
import Header from '@/components/Header/Header';
import BulkImport from '@/components/BulkImport/BulkImport';

const MAX_ROWS = 500;

export default function ImportProductsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { t } = useI18n();

  // Only signed-in sellers can import — same guard as the My Shop page.
  useEffect(() => {
    if (!authLoading && !user) router.push('/login');
  }, [authLoading, user, router]);

  return (
    <main className="min-h-screen bg-[#f0f0f0]">
      <Header />

      <div className="max-w-[980px] mx-auto pt-7 px-8 pb-16 max-[640px]:pt-5 max-[640px]:px-4 max-[640px]:pb-12">
        <button
          className="bg-white border border-[#ddd] rounded-[20px] text-[#444] text-[13px] font-semibold cursor-pointer px-4 py-[7px] mb-3.5 inline-flex items-center gap-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition-all duration-150 hover:border-[#888] hover:text-[#111] hover:-translate-x-0.5"
          onClick={() => router.push('/profile/my-ads')}
          type="button"
        >
          {t('myShop.back')}
        </button>

        <h1 className="text-[26px] font-bold text-[#222] mt-0 mx-0 mb-4">{t('import.heading')}</h1>
        <p className="text-[#898781] text-sm mt-[-8px] mx-0 mb-[18px]">
          {t('import.subheading', { max: MAX_ROWS })}
        </p>

        <BulkImport />
      </div>
    </main>
  );
}

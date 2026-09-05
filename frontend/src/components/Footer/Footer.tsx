'use client';

import Link from 'next/link';
import { useI18n } from '@/context/LanguageContext';

export default function Footer() {
    const { t } = useI18n();

    return (
      <footer className="bg-[var(--dark)] text-white pt-10 pb-5 mt-10">
        <div className="container">
          <ul className="list-none p-0 m-0 flex justify-center gap-8 mb-[30px]">
            <li><Link href="/terms" className="text-[#aaa] no-underline hover:underline">{t('footer.terms')}</Link></li>
            <li><Link href="/privacy" className="text-[#aaa] no-underline hover:underline">{t('footer.privacy')}</Link></li>
          </ul>
          <div className="text-center pt-5 border-t border-white/10 text-[#aaa] text-sm">
            <p className="text-[#aaa]">{t('footer.copyright', { year: new Date().getFullYear() })}</p>
          </div>
        </div>
      </footer>
    );
}

'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation'
import { useCart } from '@/context/CartContext';
import { useAuth } from '@/context/AuthContext'; //import hook to access global authentication data
import { useI18n, LOCALES, type Locale } from '@/context/LanguageContext';
import { useSearch } from '@/hooks/useSearch';
import SearchBar from '@/components/SearchBar/SearchBar';

type HeaderProps = {
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  onSearchSubmit?: () => void;
};

// Compact labels for the language select — each language's own short form,
// so they need no translation.
const SHORT_LANG_LABELS: Record<Locale, string> = {
  en: 'EN',
  ms: 'MS',
  zh: '中文',
};

export default function Header({
  searchValue,
  onSearchChange,
  onSearchSubmit,
}: HeaderProps) {
  const router = useRouter();
  const { user, logout } = useAuth();
  const { itemCount } = useCart();
  const { t, lang, setLang } = useI18n(); // connection to the useI18n and pull these functions
  const { searchQuery, setSearchQuery, handleSearch } = useSearch();
  const activeSearchValue = searchValue ?? searchQuery;
  const handleSearchChange = onSearchChange ?? setSearchQuery;
  const submitSearch = onSearchSubmit ?? handleSearch;

    return (
     <header className="py-4">
        <div className="container">
          <div className="grid grid-cols-[auto_minmax(200px,1fr)_auto] items-center gap-4 max-[900px]:grid-cols-1 max-[900px]:gap-2.5">
			<Link href="/" className="text-2xl font-bold text-[var(--primary)] m-0 no-underline inline-block"><h1>🏸 RacketDiction 💉 </h1></Link>
            <SearchBar value={activeSearchValue} onChange={handleSearchChange} onSubmit={submitSearch} />
            <div className="flex gap-2 flex-nowrap items-center justify-end max-[900px]:justify-start max-[900px]:flex-wrap *:shrink-0 *:whitespace-nowrap [&>.btn]:h-7 [&>.btn]:py-0 [&>.btn]:box-border [&>.btn]:inline-flex [&>.btn]:items-center">
			  <Link href="/admin/login" className="btn btn-secondary btn-sm">Admin</Link>
              {user ? (
                <>
                  <Link href="/profile" className="btn btn-secondary btn-sm">{user.username}</Link>
                  <Link href="/friends" className="btn btn-secondary btn-sm">{t('header.friends')}</Link>
                  <button className="btn btn-secondary btn-sm" onClick={logout}>{t('header.logout')}</button>
                </>
              ) : (
                <Link href="/login" className="btn btn-secondary btn-sm">{t('header.login')}</Link>
              )}
              <Link href="/cart" className="relative bg-[var(--light)] text-[var(--dark)] h-7 px-2.5 box-border border border-[var(--border)] rounded no-underline text-[15px] leading-none inline-flex items-center transition-colors duration-300 hover:bg-[#e9ecef]">🛒{itemCount > 0 && (<span className="absolute -top-1.5 -right-1.5 bg-[#ef4444] text-white rounded-full w-5 h-5 text-xs font-bold flex items-center justify-center">{itemCount}</span>)}</Link>
              <button
              className="btn btn-primary btn-sm"
              onClick={() => router.push(user ? '/profile/my-ads' : '/login')}
              >
              {t('header.myShop')}
              </button>
              <label className="inline-flex items-center gap-1.5 h-7 px-2.5 box-border border border-[var(--border)] rounded bg-[var(--light)] cursor-pointer transition-colors duration-300 hover:bg-[#e9ecef] focus-within:border-[var(--primary)]" title={t('language.label')}>
                <span className="text-sm leading-none" aria-hidden="true">🌐</span>
                <select
                  className="border-none bg-transparent text-[var(--dark)] text-xs font-medium font-[inherit] p-0 h-full cursor-pointer focus:outline-none"
                  value={lang}
                  onChange={(e) => setLang(e.target.value as Locale)}
                  aria-label={t('language.label')}
                >
                  {LOCALES.map((code) => (
                    <option key={code} value={code}>
                      {SHORT_LANG_LABELS[code]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        </div>
      </header>
    )
}

// {
//   searchValue,
//   onSearchChange,
//   onSearchSubmit,
// }: {
//   searchValue: string;
//   onSearchChange: (value: string) => void;
//   onSearchSubmit: () => void;
// })

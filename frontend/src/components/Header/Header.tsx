'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation'
import { useCart } from '@/context/CartContext';
import { useAuth } from '@/context/AuthContext'; //import hook to access global authentication data
import { useI18n, LOCALES, type Locale } from '@/context/LanguageContext';
import { useSearch } from '@/hooks/useSearch';
import SearchBar from '@/components/SearchBar/SearchBar';
import styles from './Header.module.css';

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
  const { t, lang, setLang } = useI18n();
  const { searchQuery, setSearchQuery, handleSearch } = useSearch();
  const activeSearchValue = searchValue ?? searchQuery;
  const handleSearchChange = onSearchChange ?? setSearchQuery;
  const submitSearch = onSearchSubmit ?? handleSearch;

    return (
     <header className={styles.header}>
        <div className="container">
          <div className={styles.headerTop}>
			<Link href="/" className={styles.logo}><h1>🏸 RacketDiction 💉 </h1></Link>
            <SearchBar value={activeSearchValue} onChange={handleSearchChange} onSubmit={submitSearch} />
            <div className={styles.headerActions}>
              {user ? (
                <>
                  <Link href="/profile" className="btn btn-secondary btn-sm">{user.username}</Link>
                  <Link href="/friends" className="btn btn-secondary btn-sm">{t('header.friends')}</Link>
                  <button className="btn btn-secondary btn-sm" onClick={logout}>{t('header.logout')}</button>
                </>
              ) : (
                <Link href="/login" className="btn btn-secondary btn-sm">{t('header.login')}</Link>
              )}
              <Link href="/cart" className={styles.cartBtn}>🛒{itemCount > 0 && (<span className={styles.cartBadge}>{itemCount}</span>)}</Link>
              <button
              className="btn btn-primary btn-sm"
              onClick={() => router.push(user ? '/profile/my-ads' : '/login')}
              >
              {t('header.myShop')}
              </button>
              <label className={styles.langSwitcher} title={t('language.label')}>
                <span className={styles.langIcon} aria-hidden="true">🌐</span>
                <select
                  className={styles.langSelect}
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
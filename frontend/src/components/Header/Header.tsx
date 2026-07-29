'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation'
import { useCart } from '@/context/CartContext';
import { useAuth } from '@/context/AuthContext'; //import hook to access global authentication data
import { useI18n, LOCALES, type Locale } from '@/context/LanguageContext';
import { useSearch } from '@/hooks/useSearch';
import SearchBar from '@/components/SearchBar/SearchBar';
import { resolveAvatarUrl, PLACEHOLDER_AVATAR } from '@/lib/avatar';
import NotificationBell from '@/components/NotificationBell/NotificationBell';
import { useNotifications } from '@/context/NotificationContext';

type HeaderProps = {
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  onSearchSubmit?: () => void;
};

// Each language written in itself, so the menu is readable whatever the
// current locale is.
const LANG_LABELS: Record<Locale, string> = {
  en: 'English',
  ms: 'Bahasa Melayu',
  zh: '中文',
};

const MENU_ITEM =
  'w-full text-left flex items-center gap-2.5 px-4 py-2.5 text-sm text-[#333] bg-transparent border-none no-underline cursor-pointer transition-colors duration-150 hover:bg-[#f5f5f3]';

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
  const { closePanel: closeNotifications } = useNotifications();
  const activeSearchValue = searchValue ?? searchQuery;
  const handleSearchChange = onSearchChange ?? setSearchQuery;
  const submitSearch = onSearchSubmit ?? handleSearch;

  // Account menu behind the avatar, the language menu next to it, and the
  // logout confirmation the account menu opens.
  const [menuOpen, setMenuOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const langRef = useRef<HTMLDivElement>(null);

  // Close whichever menu is open on an outside click or Escape.
  useEffect(() => {
    if (!menuOpen && !langOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current && !menuRef.current.contains(target)) setMenuOpen(false);
      if (langRef.current && !langRef.current.contains(target)) setLangOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setMenuOpen(false);
      setLangOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen, langOpen]);

  const go = (href: string) => {
    setMenuOpen(false);
    router.push(href);
  };

    return (
     <header className="py-4">
        <div className="container">
          <div className="grid grid-cols-[auto_minmax(200px,1fr)_auto] items-center gap-4 max-[900px]:grid-cols-1 max-[900px]:gap-2.5">
			<Link href="/" className="text-2xl font-bold text-[var(--primary)] m-0 no-underline inline-block"><h1>🏸 RacketDiction 💉 </h1></Link>
            <SearchBar value={activeSearchValue} onChange={handleSearchChange} onSubmit={submitSearch} />
            <div className="flex gap-2 flex-nowrap items-center justify-end max-[900px]:justify-start max-[900px]:flex-wrap *:shrink-0 *:whitespace-nowrap [&>.btn]:h-7 [&>.btn]:py-0 [&>.btn]:box-border [&>.btn]:inline-flex [&>.btn]:items-center">
              {user && (
                <NotificationBell onBeforeOpen={() => {
                  setMenuOpen(false);
                  setLangOpen(false);
                }} />
              )}
			  <Link href="/admin/login" className="btn btn-secondary btn-sm">Admin</Link>

              <Link href="/cart" className="relative bg-[var(--light)] text-[var(--dark)] h-7 px-2.5 box-border border border-[var(--border)] rounded no-underline text-[15px] leading-none inline-flex items-center transition-colors duration-300 hover:bg-[#e9ecef]">🛒{itemCount > 0 && (<span className="absolute -top-1.5 -right-1.5 bg-[#ef4444] text-white rounded-full w-5 h-5 text-xs font-bold flex items-center justify-center">{itemCount}</span>)}</Link>

              {/* Avatar + its menu. The chevron badge marks it as expandable. */}
              {user ? (
                <div className="relative" ref={menuRef}>
                  <button
                    type="button"
                    className="relative block p-0 border-none bg-transparent cursor-pointer rounded-full leading-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
                    onClick={() => {
                      closeNotifications();
                      setLangOpen(false);
                      setMenuOpen((open) => !open);
                    }}
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    aria-label={user.username}
                    title={user.username}
                  >
                    <img
                      src={resolveAvatarUrl(user.avatarUrl)}
                      alt=""
                      className={`w-9 h-9 rounded-full object-cover bg-[#f5f5f3] border-2 transition-colors duration-150 ${
                        menuOpen ? 'border-[var(--primary)]' : 'border-[#e0e0e0] hover:border-[#888]'
                      }`}
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).src = PLACEHOLDER_AVATAR;
                      }}
                    />
                    <span
                      className={`absolute -bottom-0.5 -right-0.5 w-[15px] h-[15px] rounded-full bg-white border border-[#d0d0d0] shadow-[0_1px_2px_rgba(0,0,0,0.15)] flex items-center justify-center text-[8px] leading-none text-[#333] transition-transform duration-200 ${
                        menuOpen ? 'rotate-180' : ''
                      }`}
                      aria-hidden="true"
                    >
                      ▼
                    </span>
                  </button>

                  {menuOpen && (
                    <div
                      role="menu"
                      className="absolute right-0 top-[calc(100%+8px)] z-[1100] min-w-[200px] bg-white border border-[#e8e8e6] rounded-xl shadow-[0_6px_20px_rgba(0,0,0,0.12)] overflow-hidden py-1.5"
                    >
                      <button type="button" role="menuitem" className={MENU_ITEM} onClick={() => go('/profile')}>
                        <span aria-hidden="true">👤</span>
                        {t('header.myProfile')}
                      </button>
                      <button type="button" role="menuitem" className={MENU_ITEM} onClick={() => go('/friends')}>
                        <span aria-hidden="true">👥</span>
                        {t('header.friends')}
                      </button>
                      <button type="button" role="menuitem" className={MENU_ITEM} onClick={() => go('/profile/my-ads')}>
                        <span aria-hidden="true">🏪</span>
                        {t('header.myShop')}
                      </button>

                      <div className="h-px bg-[#eee] my-1.5" />

                      <button
                        type="button"
                        role="menuitem"
                        className={`${MENU_ITEM} text-[#c62828] font-semibold hover:bg-[#fdecea]`}
                        onClick={() => {
                          setMenuOpen(false);
                          setConfirmLogout(true);
                        }}
                      >
                        <span aria-hidden="true">⎋</span>
                        {t('header.logout')}
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <Link href="/login" className="btn btn-secondary btn-sm">{t('header.login')}</Link>
              )}

              {/* Language: globe only, names live in the menu. */}
              <div className="relative" ref={langRef}>
                <button
                  type="button"
                  className={`w-9 h-9 rounded-full border bg-[var(--light)] cursor-pointer inline-flex items-center justify-center text-base leading-none p-0 transition-colors duration-150 ${
                    langOpen ? 'border-[var(--primary)]' : 'border-[var(--border)] hover:bg-[#e9ecef]'
                  }`}
                  onClick={() => {
                    closeNotifications();
                    setMenuOpen(false);
                    setLangOpen((open) => !open);
                  }}
                  aria-haspopup="menu"
                  aria-expanded={langOpen}
                  aria-label={t('language.label')}
                  title={t('language.label')}
                >
                  <span aria-hidden="true">🌐</span>
                </button>

                {langOpen && (
                  <div
                    role="menu"
                    className="absolute right-0 top-[calc(100%+8px)] z-[1100] min-w-[170px] bg-white border border-[#e8e8e6] rounded-xl shadow-[0_6px_20px_rgba(0,0,0,0.12)] overflow-hidden py-1.5"
                  >
                    {LOCALES.map((code) => (
                      <button
                        key={code}
                        type="button"
                        role="menuitemradio"
                        aria-checked={lang === code}
                        className={`${MENU_ITEM} justify-between ${lang === code ? 'font-bold text-[#c2185b]' : ''}`}
                        onClick={() => {
                          setLang(code);
                          setLangOpen(false);
                        }}
                      >
                        {LANG_LABELS[code]}
                        {lang === code && <span aria-hidden="true">✓</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Logging out discards the session, so it asks first. */}
        {confirmLogout && (
          <div
            className="fixed inset-0 z-[1200] bg-black/40 flex items-center justify-center px-4"
            onClick={() => setConfirmLogout(false)}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="logout-title"
              className="bg-white border border-[#e8e8e6] rounded-xl shadow-[0_10px_30px_rgba(0,0,0,0.2)] w-full max-w-[400px] px-5 py-[18px]"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 id="logout-title" className="text-lg font-bold text-[#222] mt-0 mx-0 mb-2">
                {t('header.logoutConfirmTitle')}
              </h2>
              <p className="text-[#898781] text-sm mt-0 mx-0 mb-5">
                {t('header.logoutConfirmBody')}
              </p>
              <div className="flex gap-2.5 justify-end flex-wrap">
                <button
                  type="button"
                  className="border border-[#ccc] bg-white rounded-lg px-3.5 py-[7px] text-[13px] font-semibold text-[#333] cursor-pointer transition-[border-color] duration-150 hover:border-[#888]"
                  onClick={() => setConfirmLogout(false)}
                >
                  {t('header.cancel')}
                </button>
                <button
                  type="button"
                  className="inline-flex items-center px-[18px] py-[7px] rounded-lg bg-[#c62828] text-white border-none text-[13px] font-semibold cursor-pointer transition-colors duration-150 hover:bg-[#a91f1f]"
                  onClick={() => {
                    setConfirmLogout(false);
                    logout();
                  }}
                >
                  {t('header.logoutConfirmYes')}
                </button>
              </div>
            </div>
          </div>
        )}
      </header>
    )
}

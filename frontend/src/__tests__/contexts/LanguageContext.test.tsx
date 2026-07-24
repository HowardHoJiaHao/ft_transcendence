// Unit tests for locale persistence, interpolation, and safe translation fallback.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { LanguageProvider, useI18n } from '@/context/LanguageContext';

function LanguageHarness() {
  const { lang, setLang, t } = useI18n();
  return (
    <div>
      <span data-testid="lang">{lang}</span>
      <span data-testid="translation">{t('myShop.tabPublished', { count: 3 })}</span>
      <span data-testid="missing">{t('missing.translation.key')}</span>
      <button onClick={() => setLang('ms')}>Use Malay</button>
    </div>
  );
}

describe('LanguageProvider', () => {
  it('restores a supported locale and updates the document language', async () => {
    localStorage.setItem('lang', 'zh');
    render(
      <LanguageProvider>
        <LanguageHarness />
      </LanguageProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('lang')).toHaveTextContent('zh'));
    expect(document.documentElement.lang).toBe('zh');
    expect(screen.getByTestId('translation')).toHaveTextContent('已发布 (3)');
  });

  it('ignores unsupported stored locales', async () => {
    localStorage.setItem('lang', 'unsupported');
    render(
      <LanguageProvider>
        <LanguageHarness />
      </LanguageProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('lang')).toHaveTextContent('en'));
    expect(document.documentElement.lang).toBe('en');
  });

  it('persists changes, interpolates variables, and returns missing keys safely', async () => {
    const user = userEvent.setup();
    render(
      <LanguageProvider>
        <LanguageHarness />
      </LanguageProvider>,
    );

    expect(screen.getByTestId('translation')).toHaveTextContent('Published (3)');
    expect(screen.getByTestId('missing')).toHaveTextContent('missing.translation.key');

    await user.click(screen.getByRole('button', { name: 'Use Malay' }));
    expect(localStorage.getItem('lang')).toBe('ms');
    expect(screen.getByTestId('translation')).toHaveTextContent('Diterbitkan (3)');
  });
});

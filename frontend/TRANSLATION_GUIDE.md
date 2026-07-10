# Translation guide (i18n)

The site supports **English (en)**, **Malay (ms)**, and **Chinese (zh)**.
A language switcher lives in the top-right of the header; the choice is saved
in `localStorage` and persists across pages and reloads.

## Where the words go — the 3 message files

All UI text lives in these JSON files, one per language:

```
frontend/src/i18n/messages/en.json   ← English (already filled in — the reference)
frontend/src/i18n/messages/ms.json   ← Malay   (YOU fill in the blank "" values)
frontend/src/i18n/messages/zh.json   ← Chinese (YOU fill in the blank "" values)
```

**Your job:** open `ms.json` and `zh.json` and replace every empty `""` with
the translation of the matching line in `en.json`. Keep the **keys** (the left
side, e.g. `"heading"`) exactly the same — only translate the **values** (the
right side).

### Example

`en.json`:
```json
"myShop": {
  "heading": "🏪 My Shop",
  "postAd": "+ Post an Ad"
}
```

`ms.json` — you change it to:
```json
"myShop": {
  "heading": "🏪 Kedai Saya",
  "postAd": "+ Siarkan Iklan"
}
```

### Placeholders — keep `{count}` as-is

Some values contain `{count}` (or other `{name}` placeholders). That gets
replaced with a real number at runtime. **Keep the `{count}` token in your
translation**, just move it to wherever it reads naturally:

```json
// en
"tabPublished": "Published ({count})",
"viewsLast30": "👁 {count} views in the last 30 days"

// ms (example — keep the {count})
"tabPublished": "Diterbitkan ({count})",
"viewsLast30": "👁 {count} tontonan dalam 30 hari terakhir"
```

### Emojis / symbols

Leave emojis (🏪, 📊, 👁, ←, →) in place — they're the same in every language.
The `language.en` / `language.ms` / `language.zh` values are intentionally the
same in all three files (each language's name is shown in its own script).

### If you leave a value blank

Any blank `""` (or a key you haven't added) automatically falls back to the
**English** text — so a half-finished translation still shows readable English,
never an empty label. Nothing breaks.

---

## For developers — how to translate a NEW piece of text

When you add UI text to a component, don't hardcode the string. Instead:

**1. Add the key to all three JSON files** (English value in `en.json`, blank
in `ms.json`/`zh.json` for the translator):
```json
// en.json
"cart": { "checkout": "Checkout" }
// ms.json and zh.json
"cart": { "checkout": "" }
```

**2. Use it in the component** via the `useI18n` hook:
```tsx
import { useI18n } from '@/context/LanguageContext';

function CartButton() {
  const { t } = useI18n();
  return <button>{t('cart.checkout')}</button>;
}
```

**3. With a number/variable**, pass it as the second argument and use
`{count}` (or any `{name}`) in the JSON:
```tsx
<span>{t('myShop.viewsLast30', { count: views })}</span>
```
```json
"viewsLast30": "👁 {count} views in the last 30 days"
```

That's it. `t()` picks the active language, falls back to English if the key
is blank/missing, and substitutes any `{...}` placeholders.

---

## Progress checklist — what's translated so far

Two areas are wired up as working examples (their keys exist in all 3 files):

- [x] **Header** (`header.*`, `language.*`) — nav links, buttons, switcher
- [x] **My Shop** page top (`myShop.*`) — heading, tabs, empty states, row actions

Still hardcoded (add keys + `t()` calls the same way when you get to them):
Analytics dashboard internals, Developer API page, product/browse pages,
chat, friends, login/register forms, cart, toasts. Each is the same
repeatable pattern shown above.

# Frontend input validation and frontend/backend consistency audit

Date: 2026-08-17  
Scope: every user-editable input on the Next.js frontend, compared to Go backend checks and `db/init.sql` column limits.  
Goal: find illogical values (letters in phone numbers, huge numbers), UI overflow from long strings, and cases where the frontend accepts more than the backend will store.

There is no Zod / Yup / react-hook-form. Validation is HTML attributes plus hand-written checks. Shared frontend ceilings live in:

- `frontend/src/lib/profileValidation.ts` (`PROFILE_LIMITS`)
- `frontend/src/lib/productOptions.ts` (`LISTING_LIMITS`)

The backend does not use `validate:` / `binding:` tags. Limits live in handler code, a few GORM tags, and PostgreSQL `CHECK` constraints.

---

## What is already aligned

These frontend caps match the Go constants and database checks.

| Field | Frontend | Backend / DB |
|---|---|---|
| Listing title | 70 | 70 runes + `CHECK (char_length(title) <= 70)` |
| Listing description | 4000 | 4000 runes + `CHECK` |
| Price | `> 0` and `≤ 100000` on submit | same + `DECIMAL(10,2)` + `CHECK` |
| Stock (create) | integer 1–100, non-digits stripped | 1–100 |
| Stock (edit) | same UI (1–100) | 0–100 allowed so a seller can mark out of stock |
| Review comment | 1000 | 1000 runes + `CHECK` |
| In-app chat (WebSocket) | 2000 | `MaxMessageLen = 2000` runes |
| Profile first / last name | 50 | 50 runes / `VARCHAR(50)` |
| Profile address | 255 | 255 runes / `VARCHAR(255)` |
| Phone (change-phone + signup submit) | 30 raw, Malaysian format | same + `VARCHAR(30)` |
| Change-email | 255 + regex | 255 + `mail.ParseAddress` |
| Listing files | 6 images × 10 MB JPEG/PNG/WebP, 2 PDFs × 5 MB | same |
| Avatar size | 2 MB | 2 MB |

Phone letters are rejected **on submit** (Malaysian `+60` / `60` / `0` + digits only, prefix/length map in `frontend/src/lib/profileValidation.ts` and `backend/modules/phone/malaysia.go`). They are not blocked while typing.

Listing cards, product-page titles, chat bubbles, notifications, and profile name/email already use `truncate`, `line-clamp`, or `overflow-wrap: anywhere`.

---

## High: frontend lets the user type more than the backend will accept

These are the “form looks valid, then save fails” cases.

### 1. Signup username is unbounded and is also stored as `firstName`

Register has no `maxLength` and no charset check. The submit body copies the username into `firstName`:

```tsx
// frontend/src/app/(user)/login/page.tsx
username, email, password, firstName: username, lastName: '',
```

`validateSignupContact` in `backend/modules/user/auth/signup_contact.go` never checks username or name length. The database is:

- `users.username` → `VARCHAR(255)`
- `users.first_name` → `VARCHAR(50)`

A 51-character username is legal in the form. The `INSERT` then fails on `first_name`. `CreateUser` errors are all mapped to **409** “User with this email or username already exists”, which is wrong for a length failure.

The same hole exists on **admin create/edit** (`frontend/src/app/admin/users/page.tsx` + `backend/admin.go`): username, email, first name, and last name have no `maxLength`. Overflow becomes 409, not a field error.

### 2. Signup email has no length or format check

Login/register email is only `type="email"` with **no `maxLength`**. Change-email uses `validateEmail()` and 255; register does not.

Backend register does **not** parse or lowercase the email. Profile update does both (`mail.ParseAddress`, `strings.ToLower`). Effects:

- `Foo@mail.com` can register
- `foo@mail.com` can fail login (exact match on `users.email`)
- more than 255 characters hits the column and again looks like a uniqueness conflict

### 3. Signup / change-password: UI accepts anything, server is strict

Frontend: `required` only. No min length, no complexity hint.

Backend `PasswordChecker` (`backend/modules/user/auth/service.go`):

- at least 8 characters
- uppercase, lowercase, special character
- must not contain the username (case-insensitive)
- **no maximum**

`password` is rejected after submit. bcrypt only uses the first **72 bytes**, so two long passwords that differ after byte 72 can collide.

A one-letter username such as `a` makes almost every password fail “must not contain your username”.

Admin create-user only requires `len(password) >= 8`. Same product, two password policies.

### 4. Profile save vs server required fields

`validateProfileFields` allows an empty address and an empty postcode. The profile page always sends both. Backend treats a sent empty address/postcode as **required**.

Clear the address, or type `12ab` in postcode (letters are not stripped on the profile page, unlike signup) → Save → `400` from the server.

### 5. Avatar type is wider on the frontend

`frontend/src/app/(user)/profile/page.tsx` uses `accept="image/*"` and only checks size.

Backend `SaveAvatar` only allows JPEG / PNG / WebP (magic-byte sniff). A GIF or SVG looks pickable, then the toast is a generic upload failure.

### 6. Developer API key name vs `VARCHAR(255)`

`frontend/src/app/(user)/profile/developer-api/page.tsx` has no `maxLength` on the key name. Empty becomes `"API Key"`. Longer than 255 is not validated in `createAPIKey` and becomes **500** “Failed to create API key”.

### 7. RacketBot message is unlimited

`frontend/src/components/AIFloatingChat/AIFloatingChat.tsx` has no `maxLength`. Go `handleAIChat` forwards the body as-is. FastAPI `ChatRequest.message` has no max.

A huge paste can trip the WAF (72 MB body / CRS), blow model context, or return a generic AI error. In-app chat is capped at 2000; RacketBot is not.

Bubbles use `break-words`, so the UI usually wraps. The request is the problem.

---

## Illogical values the UI still lets the user type

| Input | Location | What happens |
|---|---|---|
| Phone with letters | Signup, change-phone (`type="tel"`) | Letters stay in the box. Only submit runs Malaysian validation. |
| OTP | Login, email-change, password-change | Placeholder says “6-digit”. No `maxLength`, no digit-only filter. Backend wants exactly 6 digits. |
| Sell price / original price | `sell/page.tsx` `type="number"` | `e`, `E`, `+`, `1e20` are typable. Submit rejects non-finite / `≤ 0` / `> 100000`. Stock is the good pattern: non-digits are stripped. |
| Original price &lt; selling price | Sell form | Allowed. Product page still shows a strikethrough “was” price, which can be lower than the current price. |
| Home min / max price | `frontend/src/app/page.tsx` | No cap, no `min ≤ max`, no finite check. `1e308` is sent. Backend ignores unparseable values silently. |
| CSV category / condition / dealing method | `BulkImport.tsx` | Any string is accepted. Backend stores it. Home filters then never match that listing. The sell form only offers the official enums. Comment in `productOptions.ts` already notes this. |
| Search | Header, people `q`, admin search | Unbounded. Sent as `ILIKE`. `%` and `_` become SQL wildcards. |
| CSV file size | Bulk import | `accept=".csv"` only. `file.text()` reads the whole file. A huge drop can freeze the tab. Row cap (500) applies after parse. |

---

## UI overflow (long strings that can break layout)

Listing **titles** on the home grid and product page are already clamped / `overflow-wrap: anywhere`. Chat bubbles and notifications wrap.

These surfaces do **not** wrap or truncate user-controlled text:

| Surface | Field | Why it matters |
|---|---|---|
| `/friends` | username | No `truncate` / `break-words`. A 255-character username (or a Google email used as username) stretches the row. |
| Product page seller card | `sellerName` (username) | Fixed 30% column, no wrap. |
| `/user/[id]` shop header | first + last name, `@username` | Parent has `min-w-0` but the text itself has no wrap. |
| Cart + purchases | listing title, seller name | No `break-words`. |
| Admin users table | username, email, names | No truncate; table only gets a horizontal scrollbar. |
| Developer API keys table | key name | No wrap. |

Google OAuth sets `username = email` (`backend/modules/user/auth/handler.go`), so a long Gmail address shows up in all of those places.

---

## Other frontend / backend mismatches

| Topic | Frontend | Backend | Effect |
|---|---|---|---|
| HTTP `POST /api/v1/messages` | UI sends via WebSocket with 2000 cap | HTTP path has **no** max; `content` is `TEXT` | UI is fine. Anyone hitting REST can store an unlimited message. WebSocket oversize frames are **silently dropped**. |
| Listing title of only spaces | Sell form trims | `title == ""` does not trim | Public / API create can insert a whitespace-only title. |
| Public API location | Form stamps seller district/state | Public PATCH writes `location` as free text | A key caller can store a location that is not a Malaysian district. |
| Profile date of birth | `<input type="date" min="1950-01-01">` | Year ≥ 1900 | Frontend is stricter; 1900–1949 cannot be chosen. |
| Create `originalPrice ≤ 0` | Rejected on submit | Create path only checks the max, not `> 0` | UI is stricter. Import/update reject `≤ 0`. |
| Listing enums | Buttons / selects from `CATEGORIES`, `CONDITIONS`, etc. | No enum check; unknown strings stored | Filters miss those listings. Over-long category/condition/dealingMethod can 500 at Postgres (`VARCHAR(100)` / `50`). |
| Product page currency | `$` + `toFixed(2)` | Prices are MYR / RM everywhere else | Display bug, not a validation bug. |
| Homepage Condition / Rating checkboxes | Look interactive | Uncontrolled `defaultChecked`; never applied | Dead UI. |

---

## Field inventory (quick reference)

### Auth

| Field | File | Client | Backend / DB |
|---|---|---|---|
| Signup username | `login/page.tsx` | `required` only | none / `VARCHAR(255)` |
| Signup email | same | `type="email"` | none, not lowercased / `VARCHAR(255)` |
| Signup password | same | `required` | 8 + upper + lower + special + not username |
| Signup phone | same | `validatePhone`, `maxLength=30` | Malaysian normalize / `VARCHAR(30)` |
| Signup address | same | required, `maxLength=255` | required, no max at signup / `VARCHAR(255)` |
| Signup postcode | same | digits stripped, exactly 5 | `^[0-9]{5}$` / `VARCHAR(5)` |
| State / district | same | required selects | `geo.Resolve` |
| OTP | login / profile / change-password | `required` only | 6 digits, 5 min, one-use |

### Profile

| Field | File | Client | Backend / DB |
|---|---|---|---|
| firstName / lastName | `profile/page.tsx` | `maxLength=50` | ≤50 runes |
| address | same | `maxLength=255`, empty allowed | required if sent, ≤255 |
| postcode | same | `maxLength=5`, letters typable | required if sent, 5 digits |
| gender | same | Male / Female radios | same or clear → NULL |
| dateOfBirth | same | min 1950, max today | not future, year ≥ 1900 |
| avatar | same | size ≤ 2 MB, `image/*` | 2 MB, jpeg/png/webp only |
| change email | `change-email/page.tsx` | `validateEmail`, 255 | parse + lower + 255 |
| change phone | `change-phoneNo/page.tsx` | `validatePhone`, 30 | same |

`PROFILE_LIMITS.bio` is 500 and the backend caps bio at 500 runes, but there is **no bio input** in the UI.

### Listings

| Field | File | Client | Backend / DB |
|---|---|---|---|
| title | `sell/page.tsx` | required, 70 + counter | required (no trim), ≤70 |
| description | same | 4000 + counter | ≤4000 |
| price | same | `type=number`, submit `> 0` ≤ 100000 | `> 0` ≤ 100000 |
| originalPrice | same | optional, same range | create: max only; import/update: `> 0` |
| stock | same | digits, 1–100 | create ≥1; edit ≥0 |
| category / condition / specs | buttons / selects | closed enums | no enum |
| dealing method | chips, ≥1 required | joined string | required, no enum |
| location / phone | read-only from profile | — | inherited from account; listing `phone_number VARCHAR(20)` is unused on write |
| photos / PDFs | `listingFiles.ts` | type + size + counts | same |

### Other

| Field | File | Client | Backend |
|---|---|---|---|
| Review comment | product page + cart | 1000 | 1000 runes |
| Chat message | `ChatModal.tsx` | 2000 | WS 2000; HTTP none |
| People search | `chat/page.tsx` | none | unbounded `ILIKE` |
| RacketBot message | `AIFloatingChat.tsx` | none | none |
| API key name | `developer-api/page.tsx` | none | none / `VARCHAR(255)` |
| Admin user CRUD | `admin/users/page.tsx` | password `minLength=8` only | names unbounded in app code |
| Header search | `SearchBar.tsx` | none | unbounded `ILIKE` on title |

---

## Suggested fix order

1. **Signup identity** — `maxLength` + client checks that match the DB: username ≤ 255 (and preferably ≤ 50 if it is still copied to `firstName`, or stop copying it), email `validateEmail` + 255 + lowercase, password rules shown before submit, trim username.
2. **Register backend** — validate username / email / firstName / lastName / address length before `INSERT`. Do not map every insert error to “already exists”. Lowercase email at register so login matches profile.
3. **Phone and OTP** — strip to digits (and `+` for phone) on change; OTP `maxLength={6}` + numeric only.
4. **Avatar** — `accept="image/jpeg,image/png,image/webp"` and reject other types before upload.
5. **API key name** — `maxLength={255}` on the input and the same check in `createAPIKey`.
6. **RacketBot** — add a client and proxy max (for example 2000, same as chat) so a paste cannot hit the WAF.
7. **Overflow** — `truncate` or `overflow-wrap: anywhere` on friends usernames, seller name, shop header, cart titles, admin cells, API key names.
8. **Sell price inputs** — same digit / decimal filter as stock; require original price ≥ selling price if both are set.
9. **Admin create/edit** — reuse `PROFILE_LIMITS` and the member password checker.
10. **CSV import** — reject unknown category / condition / dealing method; cap file size before `file.text()`.

---

## Severity snapshot

1. Signup username → firstName + no length — register fails; error is wrong.
2. Signup email case / no max / no parse — login can fail for the same mailbox.
3. Password rules only on the server — looks like a broken form.
4. Avatar `image/*` vs jpeg/png/webp — picker lies.
5. API key name > 255 — 500.
6. RacketBot / searches unbounded — WAF 403 or ugly query strings.
7. Friends / seller / cart / admin name overflow — layout break from a long username.
8. Phone letters, OTP junk, `1e20` prices — blocked late or not at all (filters).
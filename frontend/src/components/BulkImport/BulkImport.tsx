'use client';

// Bulk product import, without page chrome so it can be embedded.
// Used by Post an Ad (Bulk upload mode) and by /profile/my-ads/import.
//
// ─── THE FULL IMPORT FLOW ─────────────────────────────────────────────────────
//
//   1. DOWNLOAD TEMPLATE  downloadTemplate() writes a one-example CSV via
//                         downloadCsv(), so the user starts from a file whose
//                         headers already match what the parser expects.
//
//   2. CHOOSE FILE        <input type="file"> hands over a File object.
//
//   3. PARSE              handleFile() reads it as text and calls parseCsv(),
//                         producing a plain grid of strings.
//
//   4. MAP COLUMNS        The header row is matched to known column names,
//                         tolerating case/space/underscore differences, so
//                         "Stock Quantity" and "stockquantity" both work.
//
//   5. VALIDATE + PREVIEW Each row becomes a ParsedRow carrying its own error
//                         list. The table below renders every row with an
//                         OK/Error status, and the import button stays
//                         disabled while any row is invalid.
//
//   6. UPLOAD             handleImport() POSTs the mapped items as JSON to
//                         /api/v1/products/import.
//
//   7. SERVER RESULT      201 → success banner. 400 with per-row errors →
//                         rendered under the upload controls so the user can
//                         fix the file and retry.
//
// ─── WHY VALIDATION EXISTS ON BOTH SIDES ──────────────────────────────────────
//
// The client-side checks in validateRow() are UX only: they give instant,
// per-row feedback without a network round trip. They are NOT a security
// boundary — anyone can POST to the endpoint directly and skip this file
// entirely. The backend re-validates every row in products_import.go and is
// the actual guarantee; these rules deliberately mirror it so the preview
// agrees with what the server will accept.
//
// The backend also inserts all-or-nothing inside a transaction, so a partially
// valid file can never leave the seller with half their listings created.

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useToast } from '@/components/Toast/ToastContext';
import { useI18n } from '@/context/LanguageContext';
import { downloadCsv, parseCsv } from '@/lib/csv';
import {
  CATEGORIES,
  CONDITIONS,
  DEALING_METHODS,
  WEIGHT_CATEGORIES,
  FLEXIBILITY_CATEGORIES,
  BALANCE_CATEGORIES,
} from '@/lib/productOptions';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || '';
// Keep in sync with maxImportRows in backend/products_import.go.
const MAX_ROWS = 500;

// Mirrors the backend CreateProductRequest fields the CSV can fill.
//
// Only title, price, location and dealingMethod are non-optional — exactly the
// four a single-listing POST requires. The dropdown columns are optional
// because applyListingDefaults fills them server-side (products.go), so a cell
// left empty imports as the value Post an Ad pre-selects rather than failing.
//
// The optional ones are `?` so an empty cell can be omitted from the JSON
// entirely: sending '' would store an empty string instead of letting the
// server apply its default.
interface ImportItem {
  title: string;
  description?: string;
  price: number;
  originalPrice?: number;
  category?: string;
  condition?: string;
  stockQuantity?: number;
  location: string;
  dealingMethod: string;
  weightCategory?: string;
  flexibilityCategory?: string;
  balanceCategory?: string;
  phoneNumber?: string;
}

// One parsed CSV line plus its client-side validation errors.
interface ParsedRow {
  line: number;
  item: ImportItem;
  errors: string[];
}

interface ServerRowError {
  row: number;
  field: string;
  message: string;
}

// Every column a row must fill. The file is rejected outright if any of these
// headers is absent, since every row would fail without them.
//
// The dropdown columns are deliberately absent from this list: a file that
// omits them entirely still imports, with every listing taking the same
// defaults it would get from a single-listing POST that omitted them.
const REQUIRED_COLUMNS = ['title', 'price', 'location', 'dealingMethod'];

// Columns the template offers; header matching is case/space/underscore-insensitive.
const TEMPLATE_COLUMNS = [
  'title', 'description', 'price', 'category', 'condition',
  'weightCategory', 'flexibilityCategory', 'balanceCategory',
  'stockQuantity', 'location', 'dealingMethod', 'phoneNumber', 'originalPrice',
];
// Two sample rows rather than one. The first fills every column; the second is
// a non-racket item with every optional cell deliberately left blank, so the
// downloaded file itself demonstrates that empty cells are acceptable and shows
// what a minimal row looks like.
const TEMPLATE_EXAMPLES = [
  [
    'Yonex Astrox 88D Pro', 'Lightly used, restrung last month', '450', 'Rackets',
    'Second-hand (Used)', '4U', 'Stiff Shaft', 'Head Heavy',
    '1', 'Kuala Lumpur', 'Meet Up', '0123456789', '699',
  ],
  [
    'Yonex AC102EX Grip', '', '12', 'Grips',
    '', '', '', '',
    '', 'Penang', 'Mailing or Delivery', '', '',
  ],
];

// What the server fills in for a blank cell (applyListingDefaults in
// backend/products.go). Named once and used by both the column reference and
// the preview, so the two can never claim different defaults — and so the
// preview shows what a row actually becomes rather than an empty cell.
const DEFAULTS = {
  category: 'Others',
  condition: 'Second-hand (Used)',
  weightCategory: '4U',
  flexibilityCategory: 'Medium Flex',
  balanceCategory: 'Even Balance',
  stockQuantity: 1,
} as const;

// The required columns, for the reference table. Only these four have no
// server-side default, so a blank cell in one of them is a genuine error.
const REQUIRED_COLUMN_NOTES: { name: string; note: string }[] = [
  { name: 'title', note: 'Listing headline. Free text, cannot be blank. Example: Yonex Astrox 88D Pro' },
  { name: 'price', note: 'Asking price in RM. Must be a number above 0. Example: 450' },
  { name: 'location', note: 'Where the item is. Free text, cannot be blank. Example: Kuala Lumpur' },
  {
    name: 'dealingMethod',
    note: `How the item changes hands. Cannot be blank. All values: ${DEALING_METHODS.join(' · ')}. For both, write "Meet Up, Mailing or Delivery" — keep the quotes, the value contains a comma.`,
  },
];

// Every optional column, for the reference table. A blank cell is acceptable in
// all of them; each note states what the listing gets instead.
const OPTIONAL_COLUMNS: { name: string; note: string }[] = [
  { name: 'description', note: 'Free text detail. Wrap in "quotes" if it contains a comma. Empty leaves the listing without one.' },
  { name: 'category', note: `Product type. Empty defaults to "${DEFAULTS.category}". All values: ${CATEGORIES.join(' · ')}` },
  { name: 'condition', note: `Item condition. Empty defaults to "${DEFAULTS.condition}". All values: ${CONDITIONS.join(' · ')}` },
  { name: 'weightCategory', note: `Racket weight class, kept only when category is "Rackets". Empty defaults to "${DEFAULTS.weightCategory}". All values: ${WEIGHT_CATEGORIES.join(' · ')}` },
  { name: 'flexibilityCategory', note: `Shaft flex, kept only when category is "Rackets". Empty defaults to "${DEFAULTS.flexibilityCategory}". All values: ${FLEXIBILITY_CATEGORIES.join(' · ')}` },
  { name: 'balanceCategory', note: `Balance point, kept only when category is "Rackets". Empty defaults to "${DEFAULTS.balanceCategory}". All values: ${BALANCE_CATEGORIES.join(' · ')}` },
  { name: 'stockQuantity', note: `Units available. Whole number, at least 1. Empty defaults to ${DEFAULTS.stockQuantity}.` },
  { name: 'phoneNumber', note: 'Contact number shown on the listing. Empty leaves it off. Example: 0123456789' },
  { name: 'originalPrice', note: 'Pre-discount price, shown struck through above the real one. Must be above 0 if given. Example: 699' },
];

// Collapse a header cell to a comparable key so the CSV's column names do not
// have to match ours exactly. "Stock Quantity", "stock_quantity" and
// "stockquantity" all normalise to the same string, which matters because
// spreadsheet apps freely reformat headers when a user edits the template.
const normalizeHeader = (h: string) => h.toLowerCase().replace(/[\s_]/g, '');

const CHIP =
  'inline-block bg-[#f5f5f3] border border-[#e8e8e6] rounded-md px-[7px] py-px text-[12.5px] text-[#c2185b]';

export default function BulkImport() {
  const { showToast } = useToast();
  const { t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<ParsedRow[]>([]);
  // File-level problem (missing columns, empty, too many rows) — blocks the preview.
  const [fileError, setFileError] = useState('');
  const [importing, setImporting] = useState(false);
  const [serverErrors, setServerErrors] = useState<ServerRowError[]>([]);
  const [importedCount, setImportedCount] = useState<number | null>(null);

  const downloadTemplate = () =>
    downloadCsv('product-import-template.csv', TEMPLATE_COLUMNS, TEMPLATE_EXAMPLES);

  // Client-side mirror of the backend's per-row validation (validateImportRow
  // in products_import.go). Returns a list of human-readable messages for one
  // row — empty means the row looks importable.
  //
  // The raw strings are passed alongside the parsed item because parsing loses
  // information that matters here. `Number('')` is 0, not NaN, so an empty
  // price cell would otherwise slip through the `<= 0` check as a legitimate
  // zero; testing the raw text catches "missing" separately from "invalid".
  const validateRow = (item: ImportItem, priceRaw: string, stockRaw: string, originalRaw: string) => {
    const errors: string[] = [];

    // title: required, and whitespace alone does not count as present.
    if (!item.title.trim()) errors.push(t('import.errTitleRequired'));

    // price: required, numeric, and strictly positive. The empty-string test
    // must come first for the Number('') === 0 reason above.
    if (priceRaw.trim() === '' || Number.isNaN(item.price) || item.price <= 0)
      errors.push(t('import.errPriceInvalid'));

    // The only two listing attributes the backend refuses to invent — the sell
    // form does not pre-select them either, so a blank cell here is a genuine
    // error rather than a default. Everything else on the row is defaulted
    // server-side by applyListingDefaults, so an empty cell is acceptable.
    //
    // Named individually so the preview points at the exact column to fix,
    // matching the per-field errors the server returns for the same row.
    ([
      ['location', item.location],
      ['dealingMethod', item.dealingMethod],
    ] as const).forEach(([name, value]) => {
      if (!value.trim()) errors.push(t('import.errFieldRequired', { field: name }));
    });

    // stockQuantity: optional, but if present must be a whole number >= 1.
    // The regex rejects decimals and signs, which Number() would happily
    // accept ("1.5" and "-2" both parse as numbers).
    if (stockRaw.trim() !== '' && (!/^\d+$/.test(stockRaw.trim()) || Number(stockRaw) < 1))
      errors.push(t('import.errStockInvalid'));

    // originalPrice: optional, but if present must be a positive number.
    // This is the struck-through "was" price, so 0 would be meaningless.
    if (originalRaw.trim() !== '' && (Number.isNaN(Number(originalRaw)) || Number(originalRaw) <= 0))
      errors.push(t('import.errOriginalPriceInvalid'));

    return errors;
  };

  // Steps 3-5 of the flow: read the chosen file, map its columns, validate
  // every row, and populate the preview table.
  //
  // Two classes of problem are handled differently. A FILE-level problem
  // (unreadable, missing required columns, too many rows) sets `fileError` and
  // aborts — there is nothing worth previewing. A ROW-level problem is kept on
  // the row itself so the user still sees the full table with the bad rows
  // marked, which is far more useful than a single message.
  const handleFile = async (file: File) => {
    // Reset every result from a previous attempt, otherwise a stale success
    // banner or old server errors would sit above the new preview.
    setFileName(file.name);
    setRows([]);
    setFileError('');
    setServerErrors([]);
    setImportedCount(null);

    // file.text() reads the whole file into memory. Fine here: MAX_ROWS caps
    // this at a few hundred KB of text.
    const grid = parseCsv(await file.text());

    // Need at least a header row plus one data row. parseCsv already dropped
    // blank lines, so a file of only whitespace lands here too.
    if (grid.length < 2) {
      setFileError(t('import.emptyFile'));
      return;
    }

    // Build a column-name → index lookup from the header row. Normalising both
    // sides means the user's capitalisation and spacing do not matter.
    const headers = grid[0].map(normalizeHeader);
    const col = (name: string) => headers.indexOf(normalizeHeader(name));

    // None of these has a default any more, so a file missing one of their
    // headers would fail on every single row. Naming the absent columns is far
    // more useful than a generic message when there are nine of them.
    const absent = REQUIRED_COLUMNS.filter((name) => col(name) === -1);
    if (absent.length > 0) {
      setFileError(t('import.missingColumns', { columns: absent.join(', ') }));
      return;
    }

    // Checked before mapping so a huge file is rejected immediately rather
    // than after building thousands of objects. -1 excludes the header row.
    // Mirrors maxImportRows on the backend, which enforces the real limit.
    if (grid.length - 1 > MAX_ROWS) {
      setFileError(t('import.tooManyRows', { max: MAX_ROWS }));
      return;
    }

    // Read one named cell from a row. Returns '' for both "column not in this
    // file" and "cell is empty", which is what the callers want: either way
    // the field is absent and should fall back to its default.
    const cell = (row: string[], name: string) => {
      const i = col(name);
      return i === -1 ? '' : (row[i] ?? '').trim();
    };

    setRows(
      // slice(1) skips the header; everything after it is data.
      grid.slice(1).map((raw, idx) => {
        // Keep the raw strings: validateRow needs them to tell "missing"
        // apart from "invalid" (see its comment).
        const priceRaw = cell(raw, 'price');
        // Accept the shorter "stock" as an alias for "stockQuantity" — a
        // common thing to type when filling the template by hand.
        const stockRaw = cell(raw, 'stockQuantity') || cell(raw, 'stock');
        const originalRaw = cell(raw, 'originalPrice');

        // Map the row onto the payload shape the backend expects. OPTIONAL
        // fields become `undefined` rather than '' so they are omitted from
        // the JSON entirely, letting the server apply its own defaults instead
        // of overwriting them with empty strings. That is what makes a blank
        // dropdown cell import as "Others" / "4U" rather than as a blank.
        //
        // title, price, location and dealingMethod are sent as-is, empty string
        // included, so the server rejects the row rather than silently filling
        // it in — they are the four it will not invent.
        const item: ImportItem = {
          title: cell(raw, 'title'),
          description: cell(raw, 'description') || undefined,
          price: Number(priceRaw),
          originalPrice: originalRaw ? Number(originalRaw) : undefined,
          category: cell(raw, 'category') || undefined,
          condition: cell(raw, 'condition') || undefined,
          stockQuantity: stockRaw ? Number(stockRaw) : undefined,
          location: cell(raw, 'location'),
          dealingMethod: cell(raw, 'dealingMethod'),
          weightCategory: cell(raw, 'weightCategory') || undefined,
          flexibilityCategory: cell(raw, 'flexibilityCategory') || undefined,
          balanceCategory: cell(raw, 'balanceCategory') || undefined,
          phoneNumber: cell(raw, 'phoneNumber') || undefined,
        };

        // `line` is 1-based over data rows, matching both the preview table
        // and the backend's row numbering, so server errors line up with what
        // the user already saw.
        return { line: idx + 1, item, errors: validateRow(item, priceRaw, stockRaw, originalRaw) };
      }),
    );
  };

  // How many rows carry at least one error (rows, not individual messages —
  // one bad row with three problems still counts once).
  const errorCount = rows.reduce((n, r) => n + (r.errors.length > 0 ? 1 : 0), 0);

  // All-or-nothing on the client too: the import button stays disabled until
  // every row is valid, matching the server's transactional behaviour. There
  // is deliberately no "import only the good rows" path — a half-imported
  // file is harder to reason about than one the user fixes and re-uploads.
  const canImport = rows.length > 0 && errorCount === 0 && !importing;

  // Steps 6-7 of the flow: send the mapped rows and interpret the response.
  const handleImport = async () => {
    // Guard even though the button is disabled — canImport also covers the
    // in-flight case, preventing a double submit from a fast second click.
    if (!canImport) return;
    setImporting(true);
    setServerErrors([]);

    const token = localStorage.getItem('token') || '';
    try {
      // Only `item` is sent; `line` and `errors` are preview-side bookkeeping.
      // The server derives the seller from the JWT, so no seller ID is sent —
      // a client-supplied one could be forged to list under another account.
      const res = await fetch(`${API_BASE}/api/v1/products/import`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ items: rows.map((r) => r.item) }),
      });

      // Tolerate a non-JSON body (proxy error page, empty 502) so a parse
      // failure surfaces as a normal error instead of throwing.
      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        // Trust the server's count over rows.length — it is the authority on
        // what was actually committed.
        const completedCount = data.imported ?? rows.length;
        setImportedCount(completedCount);
        // Clear the preview: these rows are now listings, and leaving them on
        // screen would invite a duplicate import.
        setRows([]);
        setFileName('');
        showToast(t('import.successBody', { count: completedCount }), 'success');
      } else if (Array.isArray(data.errors) && data.errors.length > 0) {
        // Per-row rejections from the server's own validation. Kept in state
        // and rendered as a list rather than a toast, because the user needs
        // to read them while editing the file. The preview is intentionally
        // left intact so the row numbers still line up.
        setServerErrors(data.errors);
      } else {
        // Any other failure (auth, rate limit, 500) has no per-row detail.
        showToast(data.error || t('import.networkError'), 'error');
      }
    } catch {
      // fetch only throws on network-level failure; HTTP errors land above.
      showToast(t('import.networkError'), 'error');
    } finally {
      // Always clear the in-flight flag so the button cannot stay stuck.
      setImporting(false);
    }
  };

  return (
    <>
      {importedCount !== null && (
        <div className="bg-[#e8f5e9] border border-[#a5d6a7] rounded-md text-[#1b5e20] text-sm px-4 py-3.5 mb-4">
          <p className="font-bold mt-0 mx-0 mb-1.5">{t('import.successTitle')}</p>
          <p className="m-0">{t('import.successBody', { count: importedCount })}</p>
          <div className="flex gap-3 items-center mt-[18px]">
            <Link
              href="/profile/my-ads"
              className="text-[#2563eb] font-semibold no-underline text-sm hover:underline"
            >
              {t('import.viewInShop')}
            </Link>
          </div>
        </div>
      )}

      {/* ── What file do I need? ── */}
      <div className="bg-white border border-[#e8e8e6] rounded-xl px-5 py-[18px] mb-6 shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
        <h2 className="flex items-center gap-2 text-base font-bold text-[#222] mt-0 mx-0 mb-3 before:content-[''] before:w-1 before:h-[18px] before:bg-[#2a78d6] before:rounded-sm before:shrink-0">
          {t('import.whatFileTitle')}
        </h2>

        <ul className="text-[#555] text-[13.5px] leading-[1.7] mt-0 mx-0 mb-4 p-0 list-none grid gap-1.5">
          <li>• {t('import.fileFormat')}</li>
          <li>• {t('import.fileRows', { max: MAX_ROWS })}</li>
          <li>• {t('import.fileNoImages')}</li>
        </ul>

        <div className="w-full overflow-x-auto">
          <table className="w-full border-collapse text-sm [&_th]:text-left [&_th]:px-3 [&_th]:py-2.5 [&_th]:border-b-2 [&_th]:border-b-[#eee] [&_th]:text-[#666] [&_th]:font-semibold [&_th]:whitespace-nowrap [&_td]:px-3 [&_td]:py-2.5 [&_td]:border-b [&_td]:border-b-[#f0f0f0] [&_td]:align-top [&_tr:last-child_td]:border-b-0">
            <thead>
              <tr>
                <th>{t('import.colColumn')}</th>
                <th>{t('import.colRequired')}</th>
                <th>{t('import.colNotes')}</th>
              </tr>
            </thead>
            <tbody>
              {REQUIRED_COLUMN_NOTES.map((c) => (
                <tr key={c.name}>
                  <td><code className={CHIP}>{c.name}</code></td>
                  <td className="font-semibold text-[#c62828] whitespace-nowrap">{t('import.required')}</td>
                  <td className="text-[#555]">{c.note}</td>
                </tr>
              ))}
              {OPTIONAL_COLUMNS.map((c) => (
                <tr key={c.name}>
                  <td><code className={CHIP}>{c.name}</code></td>
                  <td className="text-[#898781] whitespace-nowrap">{t('import.optional')}</td>
                  <td className="text-[#555]">{c.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* The spelling rule for the columns that list accepted values. The
            values themselves now sit on each column's own row in the table
            above, so repeating them here would be a second copy to keep in
            sync — only the rule a bare list cannot convey stays. */}
        <div className="bg-[#eff6ff] border border-[#bfdbfe] rounded-[10px] px-4 py-3.5 mt-4">
          <p className="text-[13.5px] font-bold text-[#1c5cab] mt-0 mx-0 mb-2">
            {t('import.valuesTitle')}
          </p>
          <p className="text-[13px] text-[#334155] m-0">{t('import.valuesHint')}</p>
        </div>
      </div>

      {/* ── How to upload ── */}
      <div className="bg-white border border-[#e8e8e6] rounded-xl px-5 py-[18px] mb-6 shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
        <h2 className="flex items-center gap-2 text-base font-bold text-[#222] mt-0 mx-0 mb-3 before:content-[''] before:w-1 before:h-[18px] before:bg-[#2a78d6] before:rounded-sm before:shrink-0">
          {t('import.howToTitle')}
        </h2>

        <ol className="text-[#555] text-[13.5px] leading-[1.7] mt-0 mx-0 mb-4 pl-[18px] grid gap-1">
          <li>{t('import.step1')}</li>
          <li>{t('import.step2')}</li>
          <li>{t('import.step3')}</li>
        </ol>

        <div className="flex gap-2.5 flex-wrap items-center">
          <button
            type="button"
            className="border border-[#ccc] bg-white rounded-lg px-3.5 py-[7px] text-[13px] font-semibold text-[#333] cursor-pointer transition-[border-color] duration-150 inline-flex items-center gap-1.5 hover:border-[#888]"
            onClick={downloadTemplate}
          >
            {t('import.downloadTemplate')}
          </button>
          <label className="border border-[#ccc] bg-white rounded-lg px-3.5 py-[7px] text-[13px] font-semibold text-[#333] cursor-pointer transition-[border-color] duration-150 inline-flex items-center gap-1.5 hover:border-[#888]">
            {t('import.chooseFile')}
            <input
              ref={fileInputRef}
              className="hidden"
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
                // Allow re-selecting the same file after fixing it
                e.target.value = '';
              }}
            />
          </label>
          {fileName && rows.length > 0 && (
            <span className="text-[13px] text-[#555] font-semibold">
              {t('import.fileSummary', {
                name: fileName,
                count: rows.length,
                errors: errorCount,
              })}
            </span>
          )}
        </div>

        {fileError && (
          <p className="bg-[#fdecea] border border-[#f5c6c0] rounded-md text-[#b71c1c] text-sm px-3.5 py-2.5 mt-4 mb-0">
            {fileError}
          </p>
        )}
        {errorCount > 0 && (
          <p className="bg-[#fdecea] border border-[#f5c6c0] rounded-md text-[#b71c1c] text-sm px-3.5 py-2.5 mt-4 mb-0">
            {t('import.fixErrors')}
          </p>
        )}

        {serverErrors.length > 0 && (
          <div className="bg-[#fdecea] border border-[#f5c6c0] rounded-md text-[#b71c1c] text-sm px-3.5 py-2.5 mt-4 mb-0">
            {t('import.serverErrors')}
            <ul className="mt-2 mb-0 pl-[18px] text-[13px]">
              {serverErrors.map((e, i) => (
                <li key={i}>
                  {t('import.serverRow', { row: e.row, field: e.field, message: e.message })}
                </li>
              ))}
            </ul>
          </div>
        )}

        {rows.length > 0 && (
          <>
            <div className="w-full overflow-x-auto mt-4">
              <table className="w-full border-collapse text-sm [&_th]:text-left [&_th]:px-3 [&_th]:py-2.5 [&_th]:border-b-2 [&_th]:border-b-[#eee] [&_th]:text-[#666] [&_th]:font-semibold [&_th]:whitespace-nowrap [&_td]:px-3 [&_td]:py-2.5 [&_td]:border-b [&_td]:border-b-[#f0f0f0] [&_tr:last-child_td]:border-b-0">
                {/* Every column the CSV carries except location, phoneNumber
                    and the three racket specs — those are either long free text
                    or only meaningful for one category, and the row is already
                    wide. The table scrolls horizontally rather than wrapping. */}
                <thead>
                  <tr>
                    <th>{t('import.colRow')}</th>
                    <th>{t('import.colTitle')}</th>
                    <th>{t('import.colDescription')}</th>
                    <th>{t('import.colPrice')}</th>
                    <th>{t('import.colOriginalPrice')}</th>
                    <th>{t('import.colCategory')}</th>
                    <th>{t('import.colCondition')}</th>
                    <th>{t('import.colStock')}</th>
                    <th>{t('import.colDealingMethod')}</th>
                    <th>{t('import.colStatus')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.line} className={r.errors.length > 0 ? '[&>td]:bg-[#fff5f5]' : ''}>
                      <td>{r.line}</td>
                      <td>
                        {r.item.title || '—'}
                        {r.errors.length > 0 && (
                          <p className="text-[#c62828] text-xs mt-1 mb-0">{r.errors.join(' · ')}</p>
                        )}
                      </td>
                      {/* Long free text, so it is clamped to one line with the
                          full value on hover — a paragraph-length description
                          would otherwise set the width of the whole table. */}
                      <td>
                        <span className="block max-w-[220px] truncate" title={r.item.description}>
                          {r.item.description || '—'}
                        </span>
                      </td>
                      <td>{Number.isNaN(r.item.price) ? '—' : `RM ${r.item.price.toFixed(2)}`}</td>
                      <td>{r.item.originalPrice ? `RM ${r.item.originalPrice.toFixed(2)}` : '—'}</td>
                      {/* Blank cells are shown as the value the server will
                          apply, not as blanks, so the preview matches the
                          listing the seller ends up with. */}
                      <td>{r.item.category ?? DEFAULTS.category}</td>
                      <td>{r.item.condition ?? DEFAULTS.condition}</td>
                      <td>{r.item.stockQuantity ?? DEFAULTS.stockQuantity}</td>
                      <td>{r.item.dealingMethod || '—'}</td>
                      <td>
                        {r.errors.length > 0 ? (
                          <span className="text-[#c62828] font-semibold whitespace-nowrap">{t('import.statusError')}</span>
                        ) : (
                          <span className="text-[#1a7f4b] font-semibold whitespace-nowrap">{t('import.statusOk')}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex gap-3 items-center mt-[18px]">
              <button
                type="button"
                className="inline-flex items-center px-[22px] py-[9px] rounded-[20px] bg-[#111] text-white border-none text-sm font-semibold cursor-pointer transition-colors duration-150 enabled:hover:bg-[#333] disabled:bg-[#bbb] disabled:cursor-not-allowed"
                disabled={!canImport}
                onClick={handleImport}
              >
                {importing ? t('import.importing') : t('import.importBtn', { count: rows.length })}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}

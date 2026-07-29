'use client';

// Bulk product import (My Shop → Import CSV).
// Flow: download template → upload CSV → client-side parse + validation preview
// → POST /api/v1/products/import. The backend re-validates every row and
// inserts all-or-nothing, so this page is UX; the server is the guarantee.

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/Toast/ToastContext';
import { useI18n } from '@/context/LanguageContext';
import Header from '@/components/Header/Header';
import { downloadCsv, parseCsv } from '@/lib/csv';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || '';
// Keep in sync with maxImportRows in backend/products_import.go.
const MAX_ROWS = 500;

// Mirrors the backend CreateProductRequest fields the CSV can fill.
interface ImportItem {
  title: string;
  description?: string;
  price: number;
  originalPrice?: number;
  category?: string;
  condition?: string;
  stockQuantity?: number;
  location?: string;
  dealingMethod?: string;
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

// Columns the template offers; header matching is case/space/underscore-insensitive.
const TEMPLATE_COLUMNS = [
  'title', 'description', 'price', 'category', 'condition',
  'stockQuantity', 'location', 'dealingMethod', 'phoneNumber', 'originalPrice',
];
const TEMPLATE_EXAMPLE = [
  'Yonex Astrox 88D Pro', 'Lightly used, restrung last month', '450', 'Rackets',
  'Second-hand (Used)', '1', 'Kuala Lumpur', 'Meet Up', '0123456789', '699',
];

const normalizeHeader = (h: string) => h.toLowerCase().replace(/[\s_]/g, '');

export default function ImportProductsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
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

  // Only sellers can import — same guard as the My Shop page.
  useEffect(() => {
    if (!authLoading && !user) router.push('/login');
  }, [authLoading, user, router]);

  const downloadTemplate = () =>
    downloadCsv('product-import-template.csv', TEMPLATE_COLUMNS, [TEMPLATE_EXAMPLE]);

  // Client-side mirror of the backend's per-row validation.
  const validateRow = (item: ImportItem, priceRaw: string, stockRaw: string, originalRaw: string) => {
    const errors: string[] = [];
    if (!item.title.trim()) errors.push(t('import.errTitleRequired'));
    if (priceRaw.trim() === '' || Number.isNaN(item.price) || item.price <= 0)
      errors.push(t('import.errPriceInvalid'));
    if (stockRaw.trim() !== '' && (!/^\d+$/.test(stockRaw.trim()) || Number(stockRaw) < 1))
      errors.push(t('import.errStockInvalid'));
    if (originalRaw.trim() !== '' && (Number.isNaN(Number(originalRaw)) || Number(originalRaw) <= 0))
      errors.push(t('import.errOriginalPriceInvalid'));
    return errors;
  };

  const handleFile = async (file: File) => {
    setFileName(file.name);
    setRows([]);
    setFileError('');
    setServerErrors([]);
    setImportedCount(null);

    const grid = parseCsv(await file.text());
    if (grid.length < 2) {
      setFileError(t('import.emptyFile'));
      return;
    }

    const headers = grid[0].map(normalizeHeader);
    const col = (name: string) => headers.indexOf(normalizeHeader(name));
    if (col('title') === -1 || col('price') === -1) {
      setFileError(t('import.missingColumns'));
      return;
    }
    if (grid.length - 1 > MAX_ROWS) {
      setFileError(t('import.tooManyRows', { max: MAX_ROWS }));
      return;
    }

    const cell = (row: string[], name: string) => {
      const i = col(name);
      return i === -1 ? '' : (row[i] ?? '').trim();
    };

    setRows(
      grid.slice(1).map((raw, idx) => {
        const priceRaw = cell(raw, 'price');
        const stockRaw = cell(raw, 'stockQuantity') || cell(raw, 'stock');
        const originalRaw = cell(raw, 'originalPrice');
        const item: ImportItem = {
          title: cell(raw, 'title'),
          description: cell(raw, 'description') || undefined,
          price: Number(priceRaw),
          originalPrice: originalRaw ? Number(originalRaw) : undefined,
          category: cell(raw, 'category') || undefined,
          condition: cell(raw, 'condition') || undefined,
          stockQuantity: stockRaw ? Number(stockRaw) : undefined,
          location: cell(raw, 'location') || undefined,
          dealingMethod: cell(raw, 'dealingMethod') || undefined,
          phoneNumber: cell(raw, 'phoneNumber') || undefined,
        };
        return { line: idx + 1, item, errors: validateRow(item, priceRaw, stockRaw, originalRaw) };
      }),
    );
  };

  const errorCount = rows.reduce((n, r) => n + (r.errors.length > 0 ? 1 : 0), 0);
  const canImport = rows.length > 0 && errorCount === 0 && !importing;

  const handleImport = async () => {
    if (!canImport) return;
    setImporting(true);
    setServerErrors([]);
    const token = localStorage.getItem('token') || '';
    try {
      const res = await fetch(`${API_BASE}/api/v1/products/import`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ items: rows.map((r) => r.item) }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setImportedCount(data.imported ?? rows.length);
        setRows([]);
        setFileName('');
      } else if (Array.isArray(data.errors) && data.errors.length > 0) {
        setServerErrors(data.errors);
      } else {
        showToast(data.error || t('import.networkError'), 'error');
      }
    } catch {
      showToast(t('import.networkError'), 'error');
    } finally {
      setImporting(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#f0f0f0]">
      <Header />

      <div className="max-w-[980px] mx-auto pt-7 px-8 pb-16">
        <button className="bg-white border border-[#ddd] rounded-[20px] text-[#444] text-[13px] font-semibold cursor-pointer px-4 py-[7px] mb-3.5 inline-flex items-center gap-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition-all duration-150 hover:border-[#888] hover:text-[#111] hover:-translate-x-0.5" onClick={() => router.push('/profile/my-ads')}>
          {t('myShop.back')}
        </button>

        <h1 className="text-[26px] font-bold text-[#222] mt-0 mx-0 mb-4">{t('import.heading')}</h1>
        <p className="text-[#898781] text-sm mt-[-8px] mx-0 mb-[18px]">{t('import.subheading', { max: MAX_ROWS })}</p>

        {importedCount !== null && (
          <div className="bg-[#e8f5e9] border border-[#a5d6a7] rounded-md text-[#1b5e20] text-sm px-4 py-3.5 mt-0 mx-0 mb-4">
            <p className="font-bold mt-0 mx-0 mb-1.5">{t('import.successTitle')}</p>
            <p>{t('import.successBody', { count: importedCount })}</p>
            <div className="flex gap-3 items-center mt-[18px]">
              <Link href="/profile/my-ads" className="text-[#2563eb] font-semibold no-underline text-sm hover:underline">
                {t('import.viewInShop')}
              </Link>
            </div>
          </div>
        )}

        <div className="bg-white border border-[#e8e8e6] rounded-xl px-5 py-[18px] mb-6 shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
          <ul className="text-[#555] text-sm mt-0 mx-0 mb-4 p-0 list-none grid gap-1.5">
            <li>{t('import.step1')}</li>
            <li>{t('import.step2')}</li>
            <li>{t('import.step3')}</li>
          </ul>

          <div className="flex gap-2.5 flex-wrap items-center">
            <button className="border border-[#ccc] bg-white rounded-lg px-3.5 py-[7px] text-[13px] font-semibold text-[#333] cursor-pointer transition-[border-color] duration-150 inline-flex items-center gap-1.5 hover:border-[#888]" onClick={downloadTemplate}>
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
          <p className="text-[#898781] text-xs mt-3 mb-0">{t('import.requiredNote')}</p>

          {fileError && <p className="bg-[#fdecea] border border-[#f5c6c0] rounded-md text-[#b71c1c] text-sm px-3.5 py-2.5 mt-4 mb-0">{fileError}</p>}
          {errorCount > 0 && <p className="bg-[#fdecea] border border-[#f5c6c0] rounded-md text-[#b71c1c] text-sm px-3.5 py-2.5 mt-4 mb-0">{t('import.fixErrors')}</p>}

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
                  <thead>
                    <tr>
                      <th>{t('import.colRow')}</th>
                      <th>{t('import.colTitle')}</th>
                      <th>{t('import.colPrice')}</th>
                      <th>{t('import.colCategory')}</th>
                      <th>{t('import.colStock')}</th>
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
                        <td>{Number.isNaN(r.item.price) ? '—' : `RM ${r.item.price.toFixed(2)}`}</td>
                        <td>{r.item.category ?? 'Others'}</td>
                        <td>{r.item.stockQuantity ?? 1}</td>
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
                <button className="inline-flex items-center px-[22px] py-[9px] rounded-[20px] bg-[#111] text-white border-none text-sm font-semibold cursor-pointer transition-colors duration-150 enabled:hover:bg-[#333] disabled:bg-[#bbb] disabled:cursor-not-allowed" disabled={!canImport} onClick={handleImport}>
                  {importing
                    ? t('import.importing')
                    : t('import.importBtn', { count: rows.length })}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

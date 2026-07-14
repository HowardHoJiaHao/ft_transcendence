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
import styles from './import.module.css';

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
    <main className={styles.main}>
      <Header />

      <div className={styles.container}>
        <button className={styles.backBtn} onClick={() => router.push('/profile/my-ads')}>
          {t('myShop.back')}
        </button>

        <h1 className={styles.heading}>{t('import.heading')}</h1>
        <p className={styles.subheading}>{t('import.subheading', { max: MAX_ROWS })}</p>

        {importedCount !== null && (
          <div className={styles.successBanner}>
            <p className={styles.successTitle}>{t('import.successTitle')}</p>
            <p>{t('import.successBody', { count: importedCount })}</p>
            <div className={styles.footerRow}>
              <Link href="/profile/my-ads" className={styles.shopLink}>
                {t('import.viewInShop')}
              </Link>
            </div>
          </div>
        )}

        <div className={styles.sectionCard}>
          <ul className={styles.steps}>
            <li>{t('import.step1')}</li>
            <li>{t('import.step2')}</li>
            <li>{t('import.step3')}</li>
          </ul>

          <div className={styles.toolbar}>
            <button className={styles.actionBtn} onClick={downloadTemplate}>
              {t('import.downloadTemplate')}
            </button>
            <label className={styles.actionBtn}>
              {t('import.chooseFile')}
              <input
                ref={fileInputRef}
                className={styles.fileInput}
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
              <span className={styles.fileSummary}>
                {t('import.fileSummary', {
                  name: fileName,
                  count: rows.length,
                  errors: errorCount,
                })}
              </span>
            )}
          </div>
          <p className={styles.note}>{t('import.requiredNote')}</p>

          {fileError && <p className={styles.errorBanner}>{fileError}</p>}
          {errorCount > 0 && <p className={styles.errorBanner}>{t('import.fixErrors')}</p>}

          {serverErrors.length > 0 && (
            <div className={styles.errorBanner}>
              {t('import.serverErrors')}
              <ul className={styles.serverErrorList}>
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
              <div className={styles.tableWrap}>
                <table className={styles.previewTable}>
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
                      <tr key={r.line} className={r.errors.length > 0 ? styles.rowError : ''}>
                        <td>{r.line}</td>
                        <td>
                          {r.item.title || '—'}
                          {r.errors.length > 0 && (
                            <p className={styles.cellErrors}>{r.errors.join(' · ')}</p>
                          )}
                        </td>
                        <td>{Number.isNaN(r.item.price) ? '—' : `RM ${r.item.price.toFixed(2)}`}</td>
                        <td>{r.item.category ?? 'Others'}</td>
                        <td>{r.item.stockQuantity ?? 1}</td>
                        <td>
                          {r.errors.length > 0 ? (
                            <span className={styles.statusError}>{t('import.statusError')}</span>
                          ) : (
                            <span className={styles.statusOk}>{t('import.statusOk')}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className={styles.footerRow}>
                <button className={styles.importBtn} disabled={!canImport} onClick={handleImport}>
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

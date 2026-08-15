// ══════════════════════════════════════════════════════════════════════════════
// SECTION 1 — ESCAPING
// Each text format has characters that would corrupt its structure. These
// helpers neutralise them, and are the only correctness-critical code here.
// ══════════════════════════════════════════════════════════════════════════════

// checking is there is " , \n and replace them
export const csvEscape = (v: string | number) => { // return string
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// swap tab become space
// swap /r/n become space
const tsvEscape = (v: string | number) => // return string
  String(v).replace(/\t/g, ' ').replace(/\r?\n/g, ' ');

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 2 — DOWNLOAD MECHANISM
// Shared by every export format. Turns a finished string into a saved file.
// ══════════════════════════════════════════════════════════════════════════════
// There is no direct "save this text" browser API, so this uses the standard
// workaround: wrap the text in a Blob, mint a temporary object URL pointing at
// it, and click an <a download> that targets that URL. The anchor is never
// added to the document — clicking a detached element still triggers the
// download, and it leaves no trace in the DOM.
//
// revokeObjectURL releases the blob afterwards; without it the data would stay
// held in memory for the lifetime of the page.
// Blob = Binary Large OBject
const downloadBlob = (filename: string, contents: string, mime: string) => {
  const url = URL.createObjectURL(new Blob([contents], { type: mime }));// make a temporary url that inside created a temporary blob)
  const a = document.createElement('a');
  a.href = url;
  a.download = filename; // the filename the browser saves as
  a.click();
  URL.revokeObjectURL(url); // Releases the blob.
};

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 3 — EXPORT
// ══════════════════════════════════════════════════════════════════════════════
// CSV and TSV get it; JSON must not, because JSON.parse rejects a leading BOM.
const UTF8_BOM = String.fromCharCode(0xfeff);

// downloadData csv.ts:188
// downloadTemplate() Builimport.tsv:131
export const downloadCsv = (
  filename: string,
  header: string[],
  rows: (string | number)[][],
) => {
  const csv = [header, ...rows].map((r) => r.map(csvEscape).join(',')).join('\n');
  downloadBlob(filename, UTF8_BOM + csv, 'text/csv;charset=utf-8');
};

// The export formats only allow these three format
export type ExportFormat = 'csv' | 'json' | 'tsv';

// Render the options in the dropdown at page.tsx:1067
// Because cannot loop over a TypeScript type
export const EXPORT_FORMATS: { value: ExportFormat; label: string }[] = [
  { value: 'csv', label: 'CSV' },
  { value: 'json', label: 'JSON' },
  { value: 'tsv', label: 'TSV' },
];

export const downloadData = (
  basename: string,
  header: string[],
  rows: (string | number)[][],
  format: ExportFormat,
) => {
  switch (format) {
    case 'json': {
      // Build json object
      // Sample
      // header = ['month', 'category', 'revenue']
      // r      = ['2026-01', 'Rackets', 450]
      // i=0 → ['month',    '2026-01']
      // i=1 → ['category', 'Rackets']
      // i=2 → ['revenue',  450]
      const objects = rows.map((r) =>
        Object.fromEntries(header.map((h, i) => [h, r[i] ?? null])),
      );
      downloadBlob(
        `${basename}.json`,
        JSON.stringify(objects, null, 2), //  converts a JavaScript value into a JSON text string
        'application/json;charset=utf-8',
      );
      break;
    }
    case 'tsv': {
      const tsv = [header, ...rows] // header first line thn continue with rows instead of 2D array
        .map((r) => r.map(tsvEscape).join('\t')) // per element in row
        .join('\n'); // for every row connect with /n
      // MIME - Multipurpose Internet Mail Extensions.
      // downloadBlob(filename, data, MIME (what kind of data is this))
      downloadBlob(
        `${basename}.tsv`,
        UTF8_BOM + tsv,
        'text/tab-separated-values;charset=utf-8',
      );
      break;
    }
    case 'csv':
    default:
      downloadCsv(`${basename}.csv`, header, rows);
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// SECTION 4 — IMPORT
// ══════════════════════════════════════════════════════════════════════════════

// Parse CSV text into rows of fields — the exact inverse of `downloadCsv`.
// Split the fields correctly with ","
// Example - Yonex Astrox,"Lightly used, restrung",450
export const parseCsv = (text: string): string[][] => {
  const rows: string[][] = []; // every completed row
  let field = '';              // characters seen since the last separator
  let row: string[] = [];      // fields completed so far on this line
  let inQuotes = false;        // is the cursor inside a "quoted field"?

  // Commit the accumulated characters as one field and reset the buffer.
  const endField = () => {
    row.push(field);
    field = '';
  };

  const endRow = () => {
    endField();
    if (row.length > 1 || row[0].trim() !== '') 
      rows.push(row);
    row = [];
  };
  
  // text.charCodeAt(0) — the numeric code of the first character
  // if it matches, start = 1; otherwise start = 0
  const start = text.charCodeAt(0) === 0xfeff ? 1 : 0;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      // Inside quotes, ',' and '\n' are ordinary data — only '"' is special.
      if (ch === '"') {
        if (text[i + 1] === '"') { // if double time "
          field += '"';
          i++;
        } else {
          inQuotes = false; // a lone quote closes the field
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;      // opens a quoted field
    } else if (ch === ',') {
      endField();           // separator: this field is done
    } else if (ch === '\n') {
      endRow();             // line ending: this row is done
    } else if (ch !== '\r') {
      // '\r' is dropped so \r\n files parse the same as \n ones; anything
      // else is ordinary content.
      field += ch;
    }
  }

  if (field !== '' || row.length > 0) endRow();
  return rows;
};

// Small CSV helpers shared by the analytics exports and the bulk import page.

// Quote CSV fields that contain commas, quotes or newlines.
export const csvEscape = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// Build a CSV from header + rows and trigger a browser download.
export const downloadCsv = (
  filename: string,
  header: string[],
  rows: (string | number)[][],
) => {
  const csv = [header, ...rows].map((r) => r.map(csvEscape).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

// Parse CSV text into rows of fields, honouring quoted fields ("a,b", doubled
// quotes) and both \n and \r\n line endings. Blank lines are skipped.
export const parseCsv = (text: string): string[][] => {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    // Skip lines that are entirely empty
    if (row.length > 1 || row[0].trim() !== '') rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++; // doubled quote inside a quoted field
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      endField();
    } else if (ch === '\n') {
      endRow();
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) endRow();
  return rows;
};

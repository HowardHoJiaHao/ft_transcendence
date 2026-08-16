import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { downloadData, EXPORT_FORMATS, csvEscape, parseCsv } from '@/lib/csv';

// downloadData builds a Blob and clicks an <a>. Capture the payload instead of
// letting jsdom attempt a real navigation.
beforeEach(() => {
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:test');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Helper: intercept the Blob passed to createObjectURL and read its text.
//
// `bytes` is the undecoded payload. It matters for the BOM assertions: Blob.text()
// runs a UTF-8 decode, and that step strips a leading BOM by definition, so the
// only way to see whether one was written is to look at the raw bytes — which is
// also exactly what a spreadsheet app looks at.
const capture = async (
  fn: () => void,
): Promise<{ name: string; type: string; text: string; bytes: Uint8Array }> => {
  // Boxed in an object so TypeScript keeps the declared type: assigning from
  // inside the mock callback is invisible to control-flow narrowing, which
  // would otherwise collapse a plain `let` to `never` after the null check.
  const captured: { blob: Blob | null } = { blob: null };
  let name = '';
  (URL.createObjectURL as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (b: Blob) => {
      captured.blob = b;
      return 'blob:test';
    },
  );
  const clickSpy = vi
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(function (this: HTMLAnchorElement) {
      name = this.download;
    });
  fn();
  clickSpy.mockRestore();
  const blob = captured.blob;
  if (!blob) throw new Error('no blob produced');
  return {
    name,
    type: blob.type,
    text: await blob.text(),
    bytes: new Uint8Array(await blob.arrayBuffer()),
  };
};

// The three bytes a UTF-8 BOM (U+FEFF) encodes to.
const BOM_BYTES = [0xef, 0xbb, 0xbf];
const startsWithBom = (bytes: Uint8Array) =>
  BOM_BYTES.every((b, i) => bytes[i] === b);

const HEADER = ['month', 'category', 'revenue'];
const ROWS: (string | number)[][] = [
  ['2026-01', 'Rackets', 120.5],
  ['2026-02', 'Shoes, Mens', 80],
];

describe('downloadData export formats', () => {
  it('offers three distinct formats', () => {
    expect(EXPORT_FORMATS.map((f) => f.value)).toEqual(['csv', 'json', 'tsv']);
  });

  it('exports CSV with the .csv extension and quotes embedded commas', async () => {
    const out = await capture(() => downloadData('report', HEADER, ROWS, 'csv'));
    expect(out.name).toBe('report.csv');
    expect(out.type).toContain('text/csv');
    const parsed = parseCsv(out.text);
    expect(parsed[0]).toEqual(HEADER);
    // The comma inside "Shoes, Mens" must survive a round-trip.
    expect(parsed[2]).toEqual(['2026-02', 'Shoes, Mens', '80']);
  });

  it('exports JSON as objects keyed by column name', async () => {
    const out = await capture(() => downloadData('report', HEADER, ROWS, 'json'));
    expect(out.name).toBe('report.json');
    expect(out.type).toContain('application/json');
    expect(JSON.parse(out.text)).toEqual([
      { month: '2026-01', category: 'Rackets', revenue: 120.5 },
      { month: '2026-02', category: 'Shoes, Mens', revenue: 80 },
    ]);
  });

  it('exports TSV with tab separators and no quoting', async () => {
    const out = await capture(() => downloadData('report', HEADER, ROWS, 'tsv'));
    expect(out.name).toBe('report.tsv');
    const lines = out.text.split('\n');
    expect(lines[0].split('\t')).toEqual(HEADER);
    // Commas are safe unquoted in TSV.
    expect(lines[2].split('\t')).toEqual(['2026-02', 'Shoes, Mens', '80']);
  });

  // Excel opens a downloaded .csv/.tsv in the machine's ANSI codepage unless the
  // file starts with a BOM — that is what turned the Sold column's "✓" into
  // "âœ“". JSON is parsed, not opened in a spreadsheet, and JSON.parse rejects a
  // leading BOM, so it must stay out of that one.
  it('prefixes CSV and TSV with a UTF-8 BOM but never JSON', async () => {
    const rows = [['✓ 2026-01-04']];
    const csv = await capture(() => downloadData('report', ['sold'], rows, 'csv'));
    const tsv = await capture(() => downloadData('report', ['sold'], rows, 'tsv'));
    const json = await capture(() => downloadData('report', ['sold'], rows, 'json'));

    expect(startsWithBom(csv.bytes)).toBe(true);
    expect(startsWithBom(tsv.bytes)).toBe(true);
    expect(startsWithBom(json.bytes)).toBe(false);
    expect(() => JSON.parse(json.text)).not.toThrow();

    // The tick itself must still be one UTF-8 "✓" in the file, not pre-mangled.
    expect(csv.text).toContain('✓');
  });

  it('collapses tabs and newlines that would break TSV structure', async () => {
    const out = await capture(() =>
      downloadData('report', ['note'], [['line1\nline2\tcol']], 'tsv'),
    );
    const lines = out.text.split('\n');
    // Header + exactly one data row: the embedded newline must not add a row.
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe('line1 line2 col');
  });
});

describe('csvEscape', () => {
  it('quotes fields containing commas, quotes or newlines', () => {
    expect(csvEscape('plain')).toBe('plain');
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
  });
});

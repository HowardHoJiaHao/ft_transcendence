// Unit tests for CSV import/export escaping and parsing edge cases.
import { describe, expect, it } from 'vitest';
import { csvEscape, parseCsv } from '@/lib/csv';

describe('CSV helpers', () => {
  it('escapes commas, quotes, and newlines safely', () => {
    expect(csvEscape('plain')).toBe('plain');
    expect(csvEscape('racket, bag')).toBe('"racket, bag"');
    expect(csvEscape('the "best" racket')).toBe('"the ""best"" racket"');
    expect(csvEscape('line one\nline two')).toBe('"line one\nline two"');
  });

  it('parses quoted commas and doubled quotes', () => {
    expect(parseCsv('title,description\n"Racket, Pro","The ""best"" model"')).toEqual([
      ['title', 'description'],
      ['Racket, Pro', 'The "best" model'],
    ]);
  });

  it('supports embedded newlines, CRLF input, and skips blank rows', () => {
    expect(parseCsv('title,description\r\nRacket,"line one\nline two"\r\n\r\n')).toEqual([
      ['title', 'description'],
      ['Racket', 'line one\nline two'],
    ]);
  });


  it('strips a leading BOM off the first header cell', () => {
    const bom = String.fromCharCode(0xfeff);
    expect(parseCsv(`${bom}title,price\nRacket,100`)).toEqual([
      ['title', 'price'],
      ['Racket', '100'],
    ]);
  });

  it('keeps empty fields so required-column validation can detect them', () => {
    expect(parseCsv('title,price\n,100\nRacket,')).toEqual([
      ['title', 'price'],
      ['', '100'],
      ['Racket', ''],
    ]);
  });
});

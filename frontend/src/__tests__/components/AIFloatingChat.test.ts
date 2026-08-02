import { describe, expect, it } from 'vitest';

import { parseProductLink } from '@/components/AIFloatingChat/AIFloatingChat';

describe('parseProductLink', () => {
  it.each([
    {
      line: 'Product link: Victor Thruster K Falcon 4U | /products/2',
      expected: { linkText: 'Victor Thruster K Falcon 4U', href: '/products/2' },
    },
    {
      line: '**Product link: Victor Thruster K Falcon 4U | /products/2**',
      expected: { linkText: 'Victor Thruster K Falcon 4U', href: '/products/2' },
    },
    {
      line: '* Product link: Apacs Feather Weight X Speed | RM150 | 6U | /products/26',
      expected: { linkText: 'Apacs Feather Weight X Speed', href: '/products/26' },
    },
  ])('parses a clickable product link from $line', ({ line, expected }) => {
    expect(parseProductLink(line)).toEqual(expected);
  });
});

// The values a listing may carry, shared by the Post an Ad form and the bulk
// CSV importer. Keeping one copy means the importer's "accepted values" help
// can never drift from what the form actually offers.
//
// Nothing validates these server-side — an unrecognised category is stored
// verbatim and then matches no filter — so showing sellers the exact strings
// is the only guard rail there is.

export const CATEGORIES = [
  'Rackets',
  'Grips',
  'Shuttlecocks',
  'Racket Bags & Covers',
  'Strings',
  'Shoes',
  'Apparel',
  'Accessories',
  'Others',
] as const;

export const CONDITIONS = ['Second-hand (Used)', 'New', 'Refurbished'] as const;

export const DEALING_METHODS = ['Meet Up', 'Mailing or Delivery'] as const;

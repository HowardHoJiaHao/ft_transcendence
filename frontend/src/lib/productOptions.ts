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

export const WEIGHT_CATEGORIES = ['1U', '2U', '3U', '4U', '5U', '6U', '7U', '8U'] as const;

export const FLEXIBILITY_CATEGORIES = [
  'Stiff Shaft',
  'Medium Flex',
  'High Flexibility',
] as const;

export const BALANCE_CATEGORIES = ['Head Heavy', 'Even Balance', 'Head Light'] as const;

// Mirrors the constants in backend/modules/listing/; the server re-validates.
export const LISTING_LIMITS = {
  title: 70,
  description: 4000,
  price: 100000,
  stock: 100,
} as const;

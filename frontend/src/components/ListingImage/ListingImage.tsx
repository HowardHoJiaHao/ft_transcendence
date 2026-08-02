'use client';

// A listing photo that falls back to the shared placeholder when it fails.
//
// The fallback is held in React state rather than assigned onto the element in
// the error handler. An imperative `event.currentTarget.src = ...` only lasts
// until the next render: React then re-applies the declared src, restores the
// broken URL and the browser shows its broken-image icon again. Because the
// grids that use this re-render on every filter, page and search change, that
// fallback was being undone constantly.

import { useState } from 'react';
import { PLACEHOLDER_LISTING_IMAGE, resolveListingImageUrl } from '@/lib/listingImage';

interface ListingImageProps {
  src?: string | null;
  alt: string;
  className?: string;
  apiBase?: string;
}

export default function ListingImage({ src, alt, className, apiBase = '' }: ListingImageProps) {
  const resolved = resolveListingImageUrl(src, apiBase);

  const [failed, setFailed] = useState(false);
  // Reset when the slot is reused for a different listing, otherwise one broken
  // photo would poison whatever renders in its place next.
  const [renderedSrc, setRenderedSrc] = useState(resolved);
  if (renderedSrc !== resolved) {
    setRenderedSrc(resolved);
    setFailed(false);
  }

  return (
    <img
      className={className}
      src={failed ? PLACEHOLDER_LISTING_IMAGE : resolved}
      alt={alt}
      onError={() => setFailed(true)}
    />
  );
}

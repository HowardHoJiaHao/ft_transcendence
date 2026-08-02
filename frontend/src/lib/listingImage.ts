// One placeholder for every listing image in the app.
//
// It is an inline SVG rather than a file so it costs no network request and
// cannot itself 404 — a fallback has to be more reliable than the thing it
// stands in for. The markup is run through encodeURIComponent instead of being
// hand-escaped, so spaces, quotes and '#' can never leave the data URI subtly
// malformed.

const PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="700" height="560" viewBox="0 0 700 560">
  <rect width="700" height="560" fill="#f1f1ee"/>
  <g fill="#cfcfc8">
    <circle cx="268" cy="212" r="38"/>
    <path d="M148 392l112-132 84 96 62-70 146 174z"/>
  </g>
  <text x="350" y="470" text-anchor="middle" fill="#8a8a85"
        font-family="Arial,Helvetica,sans-serif" font-size="34">No photo</text>
</svg>`;

export const PLACEHOLDER_LISTING_IMAGE = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  PLACEHOLDER_SVG,
)}`;

// Listing images arrive as absolute URLs, root-relative backend paths, or bare
// filenames. Anything empty resolves straight to the placeholder.
export function resolveListingImageUrl(url?: string | null, apiBase = ''): string {
  if (!url) return PLACEHOLDER_LISTING_IMAGE;
  if (/^(https?:|data:)/i.test(url)) return url;
  if (url.startsWith('/')) return `${apiBase}${url}`;
  return `${apiBase}/${url}`;
}

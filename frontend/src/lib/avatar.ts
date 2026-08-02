// Avatar URLs arrive from the API in three shapes: an absolute URL, a
// server-relative path ("/uploads/…"), or a bare path. Resolve all of them to
// something an <img> can load, and fall back to the bundled default.
//
// Shared by the header and the profile page so one avatar never renders
// differently from the other.

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

export const DEFAULT_AVATAR = '/default-avatar.png';
export const PLACEHOLDER_AVATAR = DEFAULT_AVATAR;

export const resolveAvatarUrl = (url?: string) => {
  if (!url) return DEFAULT_AVATAR;
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) return url;
  if (url.startsWith('/')) return `${API_BASE}${url}`;
  return `${API_BASE}/${url}`;
};

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

const AVATAR_CIRCLE = 'shrink-0 rounded-full object-cover bg-[#f5f5f3]';

export const AVATAR_SIZE = {
  header: 'w-12 h-12', // account button in the top-right dropdown
  list: 'w-16 h-16', // rows: friends, chat, notifications, reviews
  profile: 'w-32 h-32', // your own profile header
  shop: 'w-44 h-44', // a seller's shop card
} as const;

export type AvatarSize = keyof typeof AVATAR_SIZE;

export const avatarClass = (size: AvatarSize, extra = '') =>
  `${AVATAR_SIZE[size]} ${AVATAR_CIRCLE} ${extra}`.trim();

// For the handful of places that size the circle on a positioned WRAPPER and
// let the image fill it — the chat list hangs an online dot off the corner, so
// the rung lives on the wrapper and the image is full-bleed inside it.
export const AVATAR_FILL = `w-full h-full ${AVATAR_CIRCLE}`;

// The initial-letter stand-in for a user with no picture. Same circle, same
// rung, so one missing face does not break the rhythm of a list.
export const avatarFallbackClass = (size: AvatarSize, extra = '') =>
  `${AVATAR_SIZE[size]} shrink-0 rounded-full bg-[#ccc] text-white font-bold flex items-center justify-center leading-none ${extra}`.trim();

// Client-side mirror of validateProfileUpdate in
// backend/modules/user/profile/validation.go. UX only — the server re-validates.
// Validators return an i18n key, not a message.

import { isValidStateDistrict } from '@/lib/malaysia';

export const PROFILE_LIMITS = {
  email: 255,
  username: 255,
  phoneRaw: 30,
  name: 50,
  address: 255,
  postcode: 5,
  bio: 500,
  otp: 6,
  password: 72,
  search: 255,
  apiKeyName: 255,
} as const;

const PHONE_SEPARATORS = /[\s\-().]/g;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const POSTCODE_SHAPE = /^[0-9]{5}$/;

// Malaysian national significant number prefix -> required total length.
const MY_NSN_LENGTHS: Record<string, number> = {
  '11': 10, '15': 10,
  '10': 9, '12': 9, '13': 9, '14': 9, '16': 9, '17': 9, '18': 9, '19': 9,
  '3': 9,
  '4': 8, '5': 8, '6': 8, '7': 8, '8': 8, '9': 8,
};

export const normalizeMalaysianPhone = (raw: string): string | null => {
  const compact = raw.trim().replace(PHONE_SEPARATORS, '');
  if (!compact) return '';

  let nsn: string;
  if (compact.startsWith('+60')) nsn = compact.slice(3);
  else if (compact.startsWith('60')) nsn = compact.slice(2);
  else if (compact.startsWith('0')) nsn = compact.slice(1);
  else return null;

  if (!/^[0-9]+$/.test(nsn)) return null;
  if (MY_NSN_LENGTHS[nsn.slice(0, 2)] === nsn.length) return `+60${nsn}`;
  if (MY_NSN_LENGTHS[nsn.slice(0, 1)] === nsn.length) return `+60${nsn}`;
  return null;
};

export const normalizePhone = (raw: string) =>
  normalizeMalaysianPhone(raw) ?? raw.trim().replace(PHONE_SEPARATORS, '');

export const validateEmail = (raw: string): string | null => {
  const value = raw.trim().toLowerCase();
  if (!value) return 'validation.emailRequired';
  if (value.length > PROFILE_LIMITS.email) return 'validation.emailTooLong';
  if (!EMAIL_SHAPE.test(value)) return 'validation.emailInvalid';
  return null;
};

// An empty value is allowed and means "clear it".
export const validatePhone = (raw: string): string | null => {
  if (raw.trim().length > PROFILE_LIMITS.phoneRaw) return 'validation.phoneTooLong';
  return normalizeMalaysianPhone(raw) === null ? 'validation.phoneInvalid' : null;
};

export const validatePostcode = (raw: string): string | null => {
  const value = raw.trim();
  if (!value) return null;
  return POSTCODE_SHAPE.test(value) ? null : 'validation.postcodeInvalid';
};

export const validateMaxLength = (raw: string, max: number, key: string): string | null =>
  raw.trim().length > max ? key : null;

export const validateProfileFields = (fields: {
  firstName?: string;
  lastName?: string;
  address?: string;
  postcode?: string;
  state?: string;
  district?: string;
  bio?: string;
  dateOfBirth?: string;
}): { field: string; key: string }[] => {
  const errors: { field: string; key: string }[] = [];

  if (fields.postcode !== undefined) {
    const key = validatePostcode(fields.postcode);
    if (key) errors.push({ field: 'postcode', key });
  }

  const state = fields.state?.trim() ?? '';
  const district = fields.district?.trim() ?? '';
  if (state && !district) {
    errors.push({ field: 'district', key: 'validation.districtRequired' });
  } else if (district && !state) {
    errors.push({ field: 'state', key: 'validation.stateRequired' });
  } else if (state && district && !isValidStateDistrict(state, district)) {
    errors.push({ field: 'district', key: 'validation.districtInvalid' });
  }

  const lengths: [string, string | undefined, number][] = [
    ['firstName', fields.firstName, PROFILE_LIMITS.name],
    ['lastName', fields.lastName, PROFILE_LIMITS.name],
    ['address', fields.address, PROFILE_LIMITS.address],
    ['bio', fields.bio, PROFILE_LIMITS.bio],
  ];
  for (const [field, value, max] of lengths) {
    if (value === undefined) continue;
    const key = validateMaxLength(value, max, `validation.${field}TooLong`);
    if (key) errors.push({ field, key });
  }

  if (fields.dateOfBirth) {
    const parsed = new Date(`${fields.dateOfBirth}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) {
      errors.push({ field: 'dateOfBirth', key: 'validation.dateOfBirthInvalid' });
    } else if (parsed.getTime() > Date.now()) {
      errors.push({ field: 'dateOfBirth', key: 'validation.dateOfBirthFuture' });
    } else if (parsed.getUTCFullYear() < 1900) {
      errors.push({ field: 'dateOfBirth', key: 'validation.dateOfBirthInvalid' });
    }
  }

  return errors;
};

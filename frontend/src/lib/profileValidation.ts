// Client-side mirror of validateProfileUpdate in
// backend/modules/user/profile/validation.go. UX only — the server re-validates.
// Validators return an i18n key, not a message.

export const PROFILE_LIMITS = {
  email: 255,
  phoneRaw: 30,
  name: 50,
  address: 255,
  bio: 500,
  phoneDigitsMin: 8,
  phoneDigitsMax: 15,
} as const;

const PHONE_SEPARATORS = /[\s\-().]/g;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const normalizePhone = (raw: string) => raw.trim().replace(PHONE_SEPARATORS, '');

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
  const value = normalizePhone(raw);
  if (!value) return null;
  if (!/^\+?[0-9]+$/.test(value)) return 'validation.phoneInvalid';
  const digits = value.startsWith('+') ? value.slice(1) : value;
  if (digits.length < PROFILE_LIMITS.phoneDigitsMin || digits.length > PROFILE_LIMITS.phoneDigitsMax)
    return 'validation.phoneInvalid';
  return null;
};

export const validateMaxLength = (raw: string, max: number, key: string): string | null =>
  raw.trim().length > max ? key : null;

export const validateProfileFields = (fields: {
  firstName?: string;
  lastName?: string;
  address?: string;
  bio?: string;
  dateOfBirth?: string;
}): { field: string; key: string }[] => {
  const errors: { field: string; key: string }[] = [];

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

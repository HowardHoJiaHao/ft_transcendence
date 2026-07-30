import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
}));
vi.mock('@/components/Toast/ToastContext', () => ({
  useToast: () => ({ showToast: mocks.showToast }),
}));
vi.mock('@/context/LanguageContext', () => ({
  useI18n: () => ({
    t: (key: string) => ({
      'toast.emailUpdated': 'Email updated successfully',
      'toast.emailUpdateFailed': 'Unable to update email',
      'toast.networkError': 'Network error. Please try again.',
    }[key] || key),
  }),
}));

import ChangeEmailPage from '@/app/(user)/profile/change-email/page';

describe('ChangeEmailPage', () => {
  beforeEach(() => {
    mocks.push.mockReset();
    mocks.showToast.mockReset();
    vi.unstubAllGlobals();
    localStorage.setItem('token', 'member-token');
  });

  it('confirms a successful email update with a toast', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    }));
    const user = userEvent.setup();
    render(<ChangeEmailPage />);

    await user.type(screen.getByPlaceholderText('Enter new email'), 'new@example.com');
    await user.click(screen.getByRole('button', { name: 'Save New Email' }));

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith('Email updated successfully', 'success'));
    expect(fetch).toHaveBeenCalledWith('/api/v1/users/update', expect.objectContaining({ method: 'PUT' }));
  });

  it('shows a failure toast when the update is rejected', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Email already exists' }),
    }));
    const user = userEvent.setup();
    render(<ChangeEmailPage />);

    await user.type(screen.getByPlaceholderText('Enter new email'), 'taken@example.com');
    await user.click(screen.getByRole('button', { name: 'Save New Email' }));

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith('Email already exists', 'error'));
  });
});

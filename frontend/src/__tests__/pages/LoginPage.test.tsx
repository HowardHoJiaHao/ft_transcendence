// Unit tests for login success, backend errors, and the OTP authentication flow.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  showToast: vi.fn(),
  push: vi.fn(),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ login: mocks.login }),
}));
vi.mock('@/components/Toast/ToastContext', () => ({
  useToast: () => ({ showToast: mocks.showToast }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
}));

import LoginPage from '@/app/(user)/login/page';

const authenticatedUser = {
  id: 42,
  username: 'alice',
  email: 'alice@example.com',
  firstName: 'Alice',
  lastName: 'Player',
  status: 'active',
};

describe('LoginPage', () => {
  beforeEach(() => {
    mocks.login.mockReset();
    mocks.showToast.mockReset();
    mocks.push.mockReset();
    vi.unstubAllGlobals();
  });

  it('stores the returned token, updates auth state, and redirects after login', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'valid-jwt', user: authenticatedUser }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByPlaceholderText('Email'), 'alice@example.com');
    await user.type(screen.getByPlaceholderText('Password'), 'Strong!Password');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/auth/login');
    expect(JSON.parse(String(options.body))).toEqual({
      email: 'alice@example.com',
      password: 'Strong!Password',
    });
    expect(localStorage.getItem('token')).toBe('valid-jwt');
    expect(mocks.login).toHaveBeenCalledWith(authenticatedUser);
    expect(mocks.push).toHaveBeenCalledWith('/');
  });

  it('shows the backend error without storing credentials', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Invalid credentials' }),
    }));

    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByPlaceholderText('Email'), 'alice@example.com');
    await user.type(screen.getByPlaceholderText('Password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(mocks.showToast).toHaveBeenCalledWith('Invalid credentials', 'error');
    });
    expect(localStorage.getItem('token')).toBeNull();
    expect(mocks.login).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('completes the OTP flow using the server-issued temporary token', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ needOtp: true, tempToken: 'server-temp-token' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: 'verified-jwt', user: authenticatedUser }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByPlaceholderText('Email'), 'alice@example.com');
    await user.type(screen.getByPlaceholderText('Password'), 'Strong!Password');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));

    expect(await screen.findByRole('heading', { name: 'Enter OTP Code' })).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText('6-digit OTP'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify Code' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [url, options] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe('/api/v1/auth/verify-otp');
    expect(JSON.parse(String(options.body))).toEqual({
      tempToken: 'server-temp-token',
      otpCode: '123456',
    });
    expect(localStorage.getItem('token')).toBe('verified-jwt');
    expect(mocks.login).toHaveBeenCalledWith(authenticatedUser);
  });
});

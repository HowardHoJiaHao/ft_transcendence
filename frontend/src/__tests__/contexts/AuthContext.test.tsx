// Unit tests for frontend authentication state, persistence, updates, and logout cleanup.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '@/context/AuthContext';

const testUser = {
  id: 42,
  username: 'alice',
  email: 'alice@example.com',
  firstName: 'Alice',
  lastName: 'Player',
  role: 'user' as const,
  accountStatus: 'active' as const,
};

function AuthHarness() {
  const { user, loading, login, logout, updateUser } = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="username">{user?.username ?? 'guest'}</span>
      <span data-testid="first-name">{user?.firstName ?? ''}</span>
      <button onClick={() => login(testUser)}>Log in test user</button>
      <button onClick={() => updateUser({ firstName: 'Updated' })}>Update user</button>
      <button onClick={logout}>Log out test user</button>
    </div>
  );
}

describe('AuthProvider', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('restores a valid cached user and finishes loading', async () => {
    localStorage.setItem('user', JSON.stringify(testUser));

    render(
      <AuthProvider>
        <AuthHarness />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(screen.getByTestId('username')).toHaveTextContent('alice');
  });

  it('discards corrupted cached user data instead of crashing', async () => {
    localStorage.setItem('user', '{not valid JSON');

    render(
      <AuthProvider>
        <AuthHarness />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(screen.getByTestId('username')).toHaveTextContent('guest');
    expect(localStorage.getItem('user')).toBeNull();
  });

  it('persists login and profile updates', async () => {
    const user = userEvent.setup();
    render(
      <AuthProvider>
        <AuthHarness />
      </AuthProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Log in test user' }));
    expect(screen.getByTestId('username')).toHaveTextContent('alice');
    expect(JSON.parse(localStorage.getItem('user') ?? '{}')).toMatchObject(testUser);

    await user.click(screen.getByRole('button', { name: 'Update user' }));
    expect(screen.getByTestId('first-name')).toHaveTextContent('Updated');
    expect(JSON.parse(localStorage.getItem('user') ?? '{}')).toMatchObject({
      id: 42,
      firstName: 'Updated',
    });
  });

  it('clears local credentials and requests server logout', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    localStorage.setItem('user', JSON.stringify(testUser));
    localStorage.setItem('token', 'sensitive-token');

    const user = userEvent.setup();
    render(
      <AuthProvider>
        <AuthHarness />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('username')).toHaveTextContent('alice'));
    await user.click(screen.getByRole('button', { name: 'Log out test user' }));

    expect(screen.getByTestId('username')).toHaveTextContent('guest');
    expect(localStorage.getItem('user')).toBeNull();
    expect(localStorage.getItem('token')).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/auth/logout', {
      method: 'POST',
      credentials: 'include',
    });
  });
});

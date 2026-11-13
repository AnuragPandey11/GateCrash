import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { apiError } from '@gatecrash/api/mocks';
import { AppRoutes } from '@/routes';
import { renderWithProviders } from '@/test/render';
import { TEST_API_URL, server } from '@/test/server';

/**
 * Routing guards — FRONTEND.md §12's second non-negotiable test.
 *
 * "**Password-reset lockout.** With `mustResetPassword: true`, every navigation attempt lands on
 * the change-password screen and no other endpoint is called."
 *
 * That second clause is the one worth being strict about. `PasswordResetEnforcementFilter`
 * answers `403 PASSWORD_RESET_REQUIRED` on every path except four, and STOMP CONNECT is refused
 * too — so a client that renders the occupancy board in this state produces a screen of errors
 * and burns requests that were never going to succeed.
 */
describe('password-reset lockout', () => {
  const forbidden = ['/admin/inside', '/admin/visits', '/admin/users', '/admin/gates'];

  function failIfCalled() {
    const calls: string[] = [];
    server.use(
      ...forbidden.map((path) =>
        http.get(`${TEST_API_URL}/api/v1${path}`, ({ request }) => {
          calls.push(new URL(request.url).pathname);
          return HttpResponse.json(
            apiError(403, 'PASSWORD_RESET_REQUIRED', 'Password reset is required.'),
            { status: 403 },
          );
        }),
      ),
    );
    return calls;
  }

  it('renders only the change-password screen, whatever the URL says', async () => {
    const calls = failIfCalled();
    renderWithProviders(<AppRoutes />, { route: '/occupancy', mustResetPassword: true });

    expect(await screen.findByText('Choose a new password')).toBeInTheDocument();
    // The forced copy has to explain *why*, or the screen reads as an arbitrary interruption.
    expect(
      screen.getByText(/temporary password/i),
    ).toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it.each(['/visits', '/users', '/notifications', '/township', '/community'])(
    'redirects %s to the change-password screen',
    async (route) => {
      const calls = failIfCalled();
      renderWithProviders(<AppRoutes />, { route, mustResetPassword: true });

      expect(await screen.findByText('Choose a new password')).toBeInTheDocument();
      expect(calls).toEqual([]);
    },
  );

  it('does not render the dashboard shell at all', async () => {
    failIfCalled();
    renderWithProviders(<AppRoutes />, { route: '/occupancy', mustResetPassword: true });

    await screen.findByText('Choose a new password');
    // No nav means no way to navigate into a screen that would 403 on every query.
    expect(screen.queryByRole('navigation', { name: /primary/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Live occupancy')).not.toBeInTheDocument();
  });
});

describe('role routing', () => {
  it('gives a resident their own home, not the office dashboard', async () => {
    renderWithProviders(<AppRoutes />, {
      route: '/',
      session: { role: 'RESIDENT', loginId: 'A-101-1', fullName: 'Ravi Kumar' },
    });

    expect(await screen.findByRole('heading', { name: 'Hello, Ravi' })).toBeInTheDocument();
    expect(screen.queryByText('Live occupancy')).not.toBeInTheDocument();
    // The office's screens are not offered in the resident's navigation at all.
    expect(screen.queryByRole('link', { name: 'Users' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Guest passes' }).length).toBeGreaterThan(0);
  });

  it('does not define office routes for a resident', async () => {
    renderWithProviders(<AppRoutes />, {
      route: '/occupancy',
      session: { role: 'RESIDENT', loginId: 'A-101-1', fullName: 'Ravi Kumar' },
    });
    expect(await screen.findByText('404')).toBeInTheDocument();
    expect(screen.queryByText('Live occupancy')).not.toBeInTheDocument();
  });

  it('gives a guard the gate console', async () => {
    renderWithProviders(<AppRoutes />, { route: '/', session: { role: 'GUARD' } });
    expect(await screen.findByText('Pick the gate you are standing at to start.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Users' })).not.toBeInTheDocument();
  });

  it('adds Approvals for a guard on the sales team', async () => {
    renderWithProviders(<AppRoutes />, { route: '/', session: { role: 'GUARD', sales: true } });
    await screen.findByText('Pick the gate you are standing at to start.');
    expect(screen.getAllByRole('link', { name: 'Approvals' }).length).toBeGreaterThan(0);
  });

  it('lets an admin through to the dashboard', async () => {
    renderWithProviders(<AppRoutes />, { route: '/occupancy' });
    expect(await screen.findByText('Live occupancy')).toBeInTheDocument();
  });

  it('sends an unauthenticated visitor to login and offers no signup or reset link', async () => {
    renderWithProviders(<AppRoutes />, { route: '/occupancy', session: null });

    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    // §0: exactly two fields and no third link. Every account is admin-provisioned.
    expect(screen.queryByText(/forgot/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/sign up/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});

describe('route-level failures', () => {
  it('keeps the shell alive when one screen fails', async () => {
    server.use(
      http.get(`${TEST_API_URL}/api/v1/admin/inside`, () =>
        HttpResponse.json(apiError(500, 'INTERNAL_ERROR', 'boom'), { status: 500 }),
      ),
    );

    renderWithProviders(<AppRoutes />, { route: '/occupancy' });

    await waitFor(() => expect(screen.getByText('Something went wrong')).toBeInTheDocument());
    // The nav survives, so the admin can go somewhere else instead of reloading the tab.
    expect(screen.getAllByRole('navigation').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

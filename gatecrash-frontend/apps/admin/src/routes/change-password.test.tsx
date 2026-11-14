import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { apiError } from '@gatecrash/api/mocks';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { useSessionStore } from '@/lib/session';
import { renderWithProviders } from '@/test/render';
import { server, TEST_API_URL } from '@/test/server';
import { AppRoutes } from './index';

/**
 * The first-login password change.
 *
 * Regression: after a successful forced change the app stayed on /change-password, which the
 * signed-in app also serves (the voluntary change form) — so people saw the same form again and
 * thought they had to change their password twice.
 */
describe('first-login password change', () => {
  async function changePassword() {
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Current password'), 'Temporary#123');
    await user.type(screen.getByLabelText('New password'), 'Brand-new-pass#2026');
    await user.type(screen.getByLabelText('Confirm new password'), 'Brand-new-pass#2026');
    await user.click(screen.getByRole('button', { name: 'Set password' }));
  }

  it('lands on the home screen once the new password is set, not on the form again', async () => {
    renderWithProviders(<AppRoutes />, { route: '/occupancy', mustResetPassword: true });
    expect(await screen.findByText(/temporary password/i)).toBeInTheDocument();

    await changePassword();

    expect(await screen.findByRole('heading', { name: 'Live occupancy' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument();
    expect(useSessionStore.getState().state).toBe('authenticated');
  });

  it('a stale "reset required" reply re-checks the session instead of forcing the screen back', async () => {
    renderWithProviders(<AppRoutes />, { route: '/occupancy', mustResetPassword: true });
    await changePassword();
    await screen.findByRole('heading', { name: 'Live occupancy' });

    // A late 403 from a request sent before the change: the server now says no reset is needed.
    server.use(
      http.get(`${TEST_API_URL}/api/v1/admin/inside`, () =>
        HttpResponse.json(apiError(403, 'PASSWORD_RESET_REQUIRED', 'Password reset is required.'), {
          status: 403,
        }),
      ),
    );
    const { endpoints } = await import('@/lib/session');
    await endpoints.adminVisits.inside().catch(() => undefined);

    await waitFor(() => expect(useSessionStore.getState().state).toBe('authenticated'));
    expect(screen.queryByText(/temporary password/i)).not.toBeInTheDocument();
  });
});

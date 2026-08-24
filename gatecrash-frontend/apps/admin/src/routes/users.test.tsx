import { apiError } from '@gatecrash/api/mocks';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { UsersRoute } from '@/routes/users';
import { renderWithProviders } from '@/test/render';
import { TEST_API_URL, server } from '@/test/server';

/**
 * Users — FRONTEND.md §8.7, guardrail #3.
 *
 * The property under test is the one that actually matters: a generated password is returned
 * **once**, must reach the screen, must be hard to dismiss by accident, and must never be
 * written anywhere it could outlive the component.
 */
describe('user list', () => {
  it('lists accounts with their role and status', async () => {
    renderWithProviders(<UsersRoute />);

    expect(await screen.findByText('Ravi Kumar')).toBeInTheDocument();
    expect(screen.getByText('A-101-1')).toBeInTheDocument();
    expect(screen.getByText('Gate Guard 1')).toBeInTheDocument();
    // The guard fixture has `mustResetPassword: true` — the list has to surface that, because
    // an account stuck behind a forced reset looks identical to a working one otherwise.
    expect(screen.getByText('Must reset password')).toBeInTheDocument();
  });
});

describe('the create flow', () => {
  it('hides the login ID for a resident, because the server derives it from the flat', async () => {
    const user = userEvent.setup();
    renderWithProviders(<UsersRoute />);
    await screen.findByText('Ravi Kumar');

    await user.click(screen.getByRole('button', { name: 'Add account' }));
    const dialog = await screen.findByRole('dialog');

    // RESIDENT is the default; the server mints `A-101-1` and ignores anything we send.
    expect(within(dialog).getByText('Flat')).toBeInTheDocument();
    expect(within(dialog).getByText(/derived from the flat number/i)).toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/^Login ID/)).not.toBeInTheDocument();
  });

  it('shows the generated password once, and refuses to be dismissed by accident', async () => {
    const user = userEvent.setup();
    renderWithProviders(<UsersRoute />);
    await screen.findByText('Ravi Kumar');

    await user.click(screen.getByRole('button', { name: 'Add account' }));
    let dialog = await screen.findByRole('dialog');

    // Switch to GUARD so the flow needs only a login id and a name.
    await user.click(within(dialog).getByRole('combobox', { name: 'Role' }));
    await user.click(await screen.findByRole('option', { name: 'Guard' }));

    dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^Login ID/), 'guard-02');
    await user.type(within(dialog).getByLabelText(/^Full name/), 'Night Guard');
    await user.click(within(dialog).getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Account created')).toBeInTheDocument();
    expect(screen.getByText('Xk4p-Qm82-Tz19')).toBeInTheDocument();
    expect(screen.getByText(/shown once and cannot be retrieved/i)).toBeInTheDocument();

    // Esc must not close it: dismissing without recording the password strands the account.
    await user.keyboard('{Escape}');
    expect(screen.getByText('Xk4p-Qm82-Tz19')).toBeInTheDocument();

    // The only exit is the explicit acknowledgement.
    await user.click(screen.getByRole('button', { name: 'I have saved these credentials' }));
    await waitFor(() => expect(screen.queryByText('Xk4p-Qm82-Tz19')).not.toBeInTheDocument());
  });

  it('never writes the generated password into the query cache', async () => {
    const user = userEvent.setup();
    const { queryClient } = renderWithProviders(<UsersRoute />);
    await screen.findByText('Ravi Kumar');

    await user.click(screen.getByRole('button', { name: 'Add account' }));
    let dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('combobox', { name: 'Role' }));
    await user.click(await screen.findByRole('option', { name: 'Guard' }));
    dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^Login ID/), 'guard-02');
    await user.type(within(dialog).getByLabelText(/^Full name/), 'Night Guard');
    await user.click(within(dialog).getByRole('button', { name: 'Create account' }));

    await screen.findByText('Xk4p-Qm82-Tz19');

    // Guardrail #3: the password lives in one component's state and nowhere else. A cached copy
    // would reach devtools, any persisted cache, and any crash report.
    const serialised = JSON.stringify(queryClient.getQueryCache().getAll().map((q) => q.state.data));
    expect(serialised).not.toContain('Xk4p-Qm82-Tz19');
    expect(serialised).not.toContain('generatedPassword');
  });

  it('maps server field errors onto the fields that caused them', async () => {
    const user = userEvent.setup();
    server.use(
      http.post(`${TEST_API_URL}/api/v1/admin/users`, () =>
        HttpResponse.json(
          apiError(400, 'VALIDATION_FAILED', 'Validation failed.', {
            fieldErrors: [{ field: 'loginId', message: 'That login ID is already taken.' }],
          }),
          { status: 400 },
        ),
      ),
    );

    renderWithProviders(<UsersRoute />);
    await screen.findByText('Ravi Kumar');
    await user.click(screen.getByRole('button', { name: 'Add account' }));
    let dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('combobox', { name: 'Role' }));
    await user.click(await screen.findByRole('option', { name: 'Guard' }));
    dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^Login ID/), 'guard-01');
    await user.type(within(dialog).getByLabelText(/^Full name/), 'Night Guard');
    await user.click(within(dialog).getByRole('button', { name: 'Create account' }));

    // §11.1: inline, on the field — not a toast that leaves the admin hunting for the cause.
    expect(await screen.findByText('That login ID is already taken.')).toBeInTheDocument();
  });
});

describe('deactivation', () => {
  it('warns that the account is signed out immediately', async () => {
    const user = userEvent.setup();
    const deactivated = vi.fn();
    server.use(
      http.delete(`${TEST_API_URL}/api/v1/admin/users/:id`, ({ params }) => {
        deactivated(params.id);
        return HttpResponse.json({ active: false });
      }),
    );

    renderWithProviders(<UsersRoute />);
    await screen.findByText('Ravi Kumar');

    const menus = screen.getAllByRole('button', { name: /Ravi Kumar/ });
    await user.click(menus[0] as HTMLElement);
    await user.click(await screen.findByRole('menuitem', { name: 'Deactivate' }));

    expect(await screen.findByText('Deactivate Ravi Kumar?')).toBeInTheDocument();
    // Deactivation bumps `tokenVersion` server-side, so this is literally true and the admin
    // needs to know before clicking.
    expect(screen.getByText(/signed out immediately/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(deactivated).toHaveBeenCalledOnce());
  });
});

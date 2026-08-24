import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { LoginRoute } from '@/routes/login';
import { renderWithProviders } from '@/test/render';

/**
 * Login — FRONTEND.md §0 and §5.6.
 *
 * Two fields and no third link: there is no self-signup, no OTP and no "forgot password" anywhere
 * in this product, so a link offering one would promise a flow the backend does not have.
 */
describe('the form', () => {
  it('has exactly two fields and offers no signup or reset', async () => {
    renderWithProviders(<LoginRoute />, { session: null });

    expect(screen.getByLabelText(/Login ID/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Password/)).toBeInTheDocument();
    expect(screen.queryByText(/forgot/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});

describe('the show/hide password toggle', () => {
  it('starts hidden', () => {
    renderWithProviders(<LoginRoute />, { session: null });

    expect(screen.getByLabelText(/^Password/)).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'Show password' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('reveals and re-hides the password', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginRoute />, { session: null });

    const password = screen.getByLabelText(/^Password/);
    await user.type(password, 'Township#2026');

    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(password).toHaveAttribute('type', 'text');
    // The value survives the type swap — revealing must not clear what was typed.
    expect(password).toHaveValue('Township#2026');

    await user.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(password).toHaveAttribute('type', 'password');
    expect(password).toHaveValue('Township#2026');
  });

  it('announces the current state to a screen reader', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginRoute />, { session: null });

    await user.click(screen.getByRole('button', { name: 'Show password' }));
    // `aria-pressed` is what tells a non-sighted user the password is currently exposed.
    expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('is reachable and operable by keyboard', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginRoute />, { session: null });

    const password = screen.getByLabelText(/^Password/);
    password.focus();
    // Tabbing from the field lands on the toggle; Space activates it. A control only a mouse can
    // reach would not be keyboard-operable at all.
    await user.tab();
    expect(screen.getByRole('button', { name: 'Show password' })).toHaveFocus();

    await user.keyboard(' ');
    expect(password).toHaveAttribute('type', 'text');
  });

  it('does not submit the form when toggled', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginRoute />, { session: null });

    await user.type(screen.getByLabelText(/Login ID/), 'admin');
    await user.type(screen.getByLabelText(/^Password/), 'Township#2026');
    await user.click(screen.getByRole('button', { name: 'Show password' }));

    // A toggle that defaults to type="submit" would fire a login attempt on every peek — and
    // five failed attempts is a 15-minute lockout (§5.6).
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
    expect(screen.queryByText(/Signing in/)).not.toBeInTheDocument();
  });
});

describe('failed sign-in', () => {
  it('distinguishes a wrong password from a lockout', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginRoute />, { session: null });

    await user.type(screen.getByLabelText(/Login ID/), 'admin');
    await user.type(screen.getByLabelText(/^Password/), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('That login ID or password is not correct.')).toBeInTheDocument();
    // Still usable — a 401 is not a lockout.
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  it('disables submit and states the wait when locked out', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginRoute />, { session: null });

    await user.type(screen.getByLabelText(/Login ID/), 'lockedout');
    await user.type(screen.getByLabelText(/^Password/), 'anything');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText(/Too many failed attempts/)).toBeInTheDocument();
    // Mashing a locked login only burns the server's budget and the user's patience.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled());
  });

  it('keeps what was typed after a failure', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginRoute />, { session: null });

    await user.type(screen.getByLabelText(/Login ID/), 'admin');
    await user.type(screen.getByLabelText(/^Password/), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await screen.findByText('That login ID or password is not correct.');
    expect(screen.getByLabelText(/Login ID/)).toHaveValue('admin');
  });
});

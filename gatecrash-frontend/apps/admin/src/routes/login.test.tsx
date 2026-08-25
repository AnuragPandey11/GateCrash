import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { LoginRoute } from '@/routes/login';
import { renderWithProviders } from '@/test/render';

/**
 * Login — FRONTEND.md §0 and §5.6.
 *
 * Three fields and no link: there is no self-signup, no OTP and no "forgot password" anywhere in
 * this product, so a link offering one would promise a flow the backend does not have.
 *
 * The township code is the third field and it is part of the credential, not a filter — login ids
 * are unique only within a township. It is optional for one caller only: a super admin, who
 * belongs to no township.
 */
describe('the form', () => {
  it('has exactly three fields and offers no signup or reset', async () => {
    renderWithProviders(<LoginRoute />, { session: null });

    expect(screen.getByLabelText(/Township code/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Login ID/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Password/)).toBeInTheDocument();
    expect(screen.queryByText(/forgot/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('does not require a township code — that is how a platform operator signs in', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginRoute />, { session: null });

    await user.type(screen.getByLabelText(/Login ID/), 'superadmin');
    await user.type(screen.getByLabelText(/^Password/), 'Township#2026');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    // A blank code is submitted as *absent*, which resolves the tenantless platform namespace.
    // An empty string would instead be a present code matching no township, and a 401.
    await waitFor(() =>
      expect(
        screen.queryByText('That township code, login ID or password is not correct.'),
      ).not.toBeInTheDocument(),
    );
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

    await user.type(screen.getByLabelText(/Township code/), 'GREENWOOD');
    await user.type(screen.getByLabelText(/Login ID/), 'admin');
    await user.type(screen.getByLabelText(/^Password/), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(
      await screen.findByText('That township code, login ID or password is not correct.'),
    ).toBeInTheDocument();
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

    await user.type(screen.getByLabelText(/Township code/), 'GREENWOOD');
    await user.type(screen.getByLabelText(/Login ID/), 'admin');
    await user.type(screen.getByLabelText(/^Password/), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await screen.findByText('That township code, login ID or password is not correct.');
    // The code especially: retyping a township code on every fat-fingered password is the kind of
    // small cruelty that gets a login screen hated.
    expect(screen.getByLabelText(/Township code/)).toHaveValue('GREENWOOD');
    expect(screen.getByLabelText(/Login ID/)).toHaveValue('admin');
  });

  it('an unknown township code is indistinguishable from a wrong password', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginRoute />, { session: null });

    await user.type(screen.getByLabelText(/Township code/), 'NO-SUCH-PLACE');
    await user.type(screen.getByLabelText(/Login ID/), 'admin');
    await user.type(screen.getByLabelText(/^Password/), 'Township#2026');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    // Same message as a wrong password, by design: a distinguishable one would let anyone
    // enumerate the platform's customer list from the login form.
    expect(
      await screen.findByText('That township code, login ID or password is not correct.'),
    ).toBeInTheDocument();
  });

  it('says plainly when the township itself is suspended', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginRoute />, { session: null });

    await user.type(screen.getByLabelText(/Township code/), 'GREENWOOD');
    await user.type(screen.getByLabelText(/Login ID/), 'suspended');
    await user.type(screen.getByLabelText(/^Password/), 'Township#2026');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    // Only reachable once the credentials have verified, so it discloses nothing — and "wrong
    // password" would send a whole township chasing a problem they do not have.
    expect(await screen.findByText(/not currently active/)).toBeInTheDocument();
  });
});

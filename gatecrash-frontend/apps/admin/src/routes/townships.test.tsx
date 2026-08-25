import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { apiError } from '@gatecrash/api/mocks';
import { AppRoutes } from '@/routes';
import { TownshipsRoute } from '@/routes/townships';
import { useSessionStore } from '@/lib/session';
import { SUPER_ADMIN_SESSION, renderWithProviders } from '@/test/render';
import { TEST_API_URL, server } from '@/test/server';

/**
 * The platform console — FRONTEND.md §16 phase F5b.
 *
 * The routing cases below matter more than the CRUD ones. A `SUPER_ADMIN` belongs to no township,
 * so every township-scoped endpoint answers `422 TOWNSHIP_CONTEXT_REQUIRED` until one is selected
 * — an operator landed on the occupancy board would see a screen of errors and reasonably conclude
 * the app is broken. These assert that the app never puts them there.
 */
describe('routing for a platform operator', () => {
  it('sends a super admin with no township selected to the console', async () => {
    renderWithProviders(<AppRoutes />, { route: '/occupancy', session: SUPER_ADMIN_SESSION });

    expect(await screen.findByRole('heading', { name: 'Townships' })).toBeInTheDocument();
  });

  it('keeps every township-scoped route unreachable until one is chosen', async () => {
    // Not a `path="*"` guard: React Router ranks by specificity, so `/users` would out-rank a
    // catch-all and render a screen whose every request is refused. The routes are not defined
    // at all in this state, which is what makes the redirect happen.
    for (const route of ['/users', '/visits', '/notifications', '/community', '/township']) {
      const view = renderWithProviders(<AppRoutes />, { route, session: SUPER_ADMIN_SESSION });
      expect(await screen.findByRole('heading', { name: 'Townships' })).toBeInTheDocument();
      view.unmount();
    }
  });

  it('opens the township-scoped app once a township is selected', async () => {
    renderWithProviders(<AppRoutes />, { route: '/occupancy', session: SUPER_ADMIN_SESSION });
    await screen.findByRole('heading', { name: 'Townships' });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Work in this township' }));

    // The occupancy nav item only exists once there is a township for it to resolve against.
    // `findAll` because the shell renders both a desktop sidebar and a mobile nav row.
    expect(await screen.findAllByRole('link', { name: /Occupancy/ })).not.toHaveLength(0);
  });

  it('never shows the platform console to a township admin', async () => {
    renderWithProviders(<AppRoutes />, { route: '/townships' });

    // An ADMIN falls through to not-found rather than seeing a console that would 403 anyway.
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Townships' })).not.toBeInTheDocument(),
    );
  });
});

describe('the township list', () => {
  it('hides archived townships until asked for them', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TownshipsRoute />, { session: SUPER_ADMIN_SESSION });

    expect(await screen.findByText('GREENWOOD')).toBeInTheDocument();
    expect(screen.queryByText('WESTGATE')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show archived' }));
    expect(await screen.findByText('WESTGATE')).toBeInTheDocument();
  });

  it('does not offer to work inside an archived township', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TownshipsRoute />, { session: SUPER_ADMIN_SESSION });
    await user.click(screen.getByRole('button', { name: 'Show archived' }));

    const archivedRow = (await screen.findByText('WESTGATE')).closest('tr');
    // The server answers 409 TOWNSHIP_ARCHIVED for that, so offering the button would be a lie.
    // Restore first is the honest order, and the only control the row shows.
    expect(within(archivedRow as HTMLElement).queryByRole('button', { name: 'Work in this township' }))
      .not.toBeInTheDocument();
    expect(within(archivedRow as HTMLElement).getByRole('button', { name: 'Restore' }))
      .toBeInTheDocument();
  });
});

describe('onboarding a township', () => {
  it('creates the township and shows the admin credential exactly once', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TownshipsRoute />, { session: SUPER_ADMIN_SESSION });

    await user.click(await screen.findByRole('button', { name: /New township/ }));
    await user.type(screen.getByLabelText(/Township code/), 'riverside');
    await user.type(screen.getByLabelText(/Township name/), 'Riverside Township');
    await user.type(screen.getByLabelText(/Admin login ID/), 'riverside-admin');
    await user.type(screen.getByLabelText(/Admin full name/), 'Asha Rao');
    await user.click(screen.getByRole('button', { name: 'Create township' }));

    // The hand-off card must carry the township code as well as the login id — the credential is
    // the pair, and a card without the code is one nobody can sign in with.
    expect(await screen.findByText('Account created')).toBeInTheDocument();
    expect(screen.getByText('RIVERSIDE')).toBeInTheDocument();
    expect(screen.getByText('riverside-admin')).toBeInTheDocument();
    expect(screen.getByText('Xk7-Rq2m-Zt9v')).toBeInTheDocument();
  });
});

describe('archiving', () => {
  it('requires the township code typed back before the button works', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TownshipsRoute />, { session: SUPER_ADMIN_SESSION });

    await user.click(await screen.findByRole('button', { name: 'Archive' }));

    const dialog = screen.getByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Archive' });
    // Archiving takes a whole community offline in one request; a second click is not enough.
    expect(confirm).toBeDisabled();

    await user.type(within(dialog).getByLabelText(/Type GREENWOOD/), 'GREENWO');
    expect(confirm).toBeDisabled();
    expect(within(dialog).getByText(/does not match/)).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText(/Type GREENWOOD/), 'OD');
    await waitFor(() => expect(confirm).toBeEnabled());
  });

  it('says what archiving actually does, since the word reads as "delete"', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TownshipsRoute />, { session: SUPER_ADMIN_SESSION });

    await user.click(await screen.findByRole('button', { name: 'Archive' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/visitor log and audit trail are kept/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/Restore reverses this/i)).toBeInTheDocument();
  });
});

describe('township administrators', () => {
  it('surfaces the server refusing to remove the last admin', async () => {
    server.use(
      http.delete(`${TEST_API_URL}/api/v1/super/townships/:id/admins/:userId`, () =>
        HttpResponse.json(
          apiError(
            409,
            'LAST_TOWNSHIP_ADMIN',
            'Appoint another administrator before removing the last one.',
          ),
          { status: 409 },
        ),
      ),
    );

    const user = userEvent.setup();
    renderWithProviders(<TownshipsRoute />, { session: SUPER_ADMIN_SESSION });

    // The admin count doubles as the disclosure toggle for the row's administrators.
    await user.click(await screen.findByRole('button', { name: '1' }));
    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }),
    );

    // The message is the actionable part — it says exactly what to do about it.
    expect(await screen.findByText(/Appoint another administrator/)).toBeInTheDocument();
  });
});

describe('session teardown', () => {
  it('forgets the acting township on sign-out', () => {
    useSessionStore.getState().setMe(SUPER_ADMIN_SESSION);
    useSessionStore.getState().setActingTownship('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    useSessionStore.getState().setUnauthenticated();

    // A leftover township would be sent as X-Township-Id by the next person to sign in on this
    // browser — a cross-tenant header, from a stale store, on somebody else's session.
    expect(useSessionStore.getState().actingTownshipId).toBeNull();
  });
});

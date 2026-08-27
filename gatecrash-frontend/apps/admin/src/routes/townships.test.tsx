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

  /**
   * Onboarding is the only moment the structure is easy to get right — the level set cannot be
   * reshaped once units exist. So the choice has to be on this form, and it has to show what it
   * will produce rather than hiding it behind a dropdown label.
   */
  it('offers project types grouped by category, with the structure each would produce', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TownshipsRoute />, { session: SUPER_ADMIN_SESSION });

    await user.click(await screen.findByRole('button', { name: /New township/ }));

    // The default is shown, not silently assumed: the super admin can see it is an apartment
    // complex and that it will produce Tower -> Floor -> Flat.
    const dialog = screen.getByRole('dialog');
    await waitFor(() => {
      expect(within(dialog).getByText('Tower')).toBeInTheDocument();
    });
    expect(within(dialog).getByText('Floor')).toBeInTheDocument();
    expect(within(dialog).getByText('Flat')).toBeInTheDocument();

    await user.click(within(dialog).getByLabelText(/Project type/));
    // Fifteen presets would be an undifferentiated list without the category headings.
    expect(await screen.findByText('Residential')).toBeInTheDocument();
    expect(screen.getByText('Commercial')).toBeInTheDocument();
  });

  it('switching to a mall changes the structure to levels of shops', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TownshipsRoute />, { session: SUPER_ADMIN_SESSION });

    await user.click(await screen.findByRole('button', { name: /New township/ }));
    const dialog = screen.getByRole('dialog');

    await user.click(within(dialog).getByLabelText(/Project type/));
    await user.click(await screen.findByRole('option', { name: 'Mall / retail centre' }));

    // A mall is not a housing block, and the console says so before anything is created.
    await waitFor(() => {
      expect(within(dialog).getByText('Shop')).toBeInTheDocument();
    });
    expect(within(dialog).getByText('Level')).toBeInTheDocument();
    expect(within(dialog).queryByText('Flat')).not.toBeInTheDocument();
  });

  it('sends the chosen project type when the township is created', async () => {
    let sent: Record<string, unknown> | null = null;
    server.use(
      http.post(`${TEST_API_URL}/api/v1/super/townships`, async ({ request }) => {
        sent = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          {
            township: {
              id: '99999999-9999-4999-8999-999999999999',
              code: 'PALMS',
              name: 'Palm Estate',
              status: 'ACTIVE',
              propertyType: 'VILLA',
              activeUserCount: 1,
              activeAdminCount: 1,
              blockCount: 0,
              unitCount: 0,
              gateCount: 0,
              createdAt: '2026-08-27T10:00:00+05:30',
            },
            admin: {
              id: '88888888-8888-4888-8888-888888888888',
              loginId: 'palms-admin',
              fullName: 'Palms Admin',
              role: 'ADMIN',
              generatedPassword: 'Xk7-Rq2m-Zt9v',
            },
          },
          { status: 201 },
        );
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<TownshipsRoute />, { session: SUPER_ADMIN_SESSION });

    await user.click(await screen.findByRole('button', { name: /New township/ }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Township code/), 'palms');
    await user.type(within(dialog).getByLabelText(/Township name/), 'Palm Estate');
    await user.click(within(dialog).getByLabelText(/Project type/));
    await user.click(await screen.findByRole('option', { name: 'Villa community' }));
    await user.type(within(dialog).getByLabelText(/Admin login ID/), 'palms-admin');
    await user.type(within(dialog).getByLabelText(/Admin full name/), 'Palms Admin');
    await user.click(within(dialog).getByRole('button', { name: 'Create township' }));

    await waitFor(() => {
      expect(sent).not.toBeNull();
    });
    expect(sent!.propertyType).toBe('VILLA');
    // No explicit levels: the preset is followed, so the server seeds it and the two descriptions
    // of the structure cannot drift apart.
    expect(sent!.levels).toBeUndefined();
  });

  /**
   * The dialog is centred with a -50% translate, so before the height bound was added a tall form
   * grew off both ends of the viewport and its footer became unreachable: the super admin could see
   * the whole form and could not submit it. The onboarding dialog is the tallest in the app, so it
   * is the one that guards this.
   */
  it('keeps the create button reachable however tall the form gets', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TownshipsRoute />, { session: SUPER_ADMIN_SESSION });

    await user.click(await screen.findByRole('button', { name: /New township/ }));
    const dialog = screen.getByRole('dialog');

    // Expand the form to its tallest state: the level editor open, with an extra level.
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Customise' })).toBeInTheDocument();
    });
    await user.click(within(dialog).getByRole('button', { name: 'Customise' }));
    await user.click(within(dialog).getByRole('button', { name: 'Add level' }));

    // The footer is a sibling of the scrolling body, not inside it, so it cannot scroll away.
    const create = within(dialog).getByRole('button', { name: 'Create township' });
    expect(create).toBeInTheDocument();
    expect(create.closest('[data-slot="dialog-body"]')).toBeNull();
  });

  it('refuses an invalid structure inline instead of on submit', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TownshipsRoute />, { session: SUPER_ADMIN_SESSION });

    await user.click(await screen.findByRole('button', { name: /New township/ }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Township code/), 'broken');
    await user.type(within(dialog).getByLabelText(/Township name/), 'Broken Estate');
    await user.type(within(dialog).getByLabelText(/Admin login ID/), 'broken-admin');
    await user.type(within(dialog).getByLabelText(/Admin full name/), 'Broken Admin');

    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Customise' })).toBeInTheDocument();
    });
    await user.click(within(dialog).getByRole('button', { name: 'Customise' }));

    // Two UNIT levels: the server would answer 422 UNIT_LEVEL_REQUIRED, which is a poor way to
    // find out after filling in the rest of the form.
    const kinds = within(dialog).getAllByLabelText('Kind');
    await user.click(kinds[0]!);
    await user.click(await screen.findByRole('option', { name: 'UNIT' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      /exactly one level must be the addressable unit level/i,
    );
    expect(within(dialog).getByRole('button', { name: 'Create township' })).toBeDisabled();
  });

  it('sends an explicit level set once the structure is customised', async () => {
    let sent: Record<string, unknown> | null = null;
    server.use(
      http.post(`${TEST_API_URL}/api/v1/super/townships`, async ({ request }) => {
        sent = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ township: {}, admin: {} }, { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<TownshipsRoute />, { session: SUPER_ADMIN_SESSION });

    await user.click(await screen.findByRole('button', { name: /New township/ }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Township code/), 'bespoke');
    await user.type(within(dialog).getByLabelText(/Township name/), 'Bespoke Estate');

    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Customise' })).toBeInTheDocument();
    });
    await user.click(within(dialog).getByRole('button', { name: 'Customise' }));

    // Rename the outermost level to something no preset offers.
    const singulars = within(dialog).getAllByLabelText('Singular');
    await user.clear(singulars[0]!);
    await user.type(singulars[0]!, 'Precinct');

    await user.type(within(dialog).getByLabelText(/Admin login ID/), 'bespoke-admin');
    await user.type(within(dialog).getByLabelText(/Admin full name/), 'Bespoke Admin');
    await user.click(within(dialog).getByRole('button', { name: 'Create township' }));

    await waitFor(() => {
      expect(sent).not.toBeNull();
    });
    const levels = sent!.levels as { singular: string }[];
    expect(levels[0]!.singular).toBe('Precinct');
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

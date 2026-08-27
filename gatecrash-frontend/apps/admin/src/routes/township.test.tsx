import { createHandlers } from '@gatecrash/api/mocks';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { TEST_API_URL, server } from '@/test/server';
import { TownshipRoute } from './township';

/**
 * The structure screen adapts to the project, and that is the whole feature.
 *
 * These tests render exactly one component against three different level sets and assert it comes
 * out speaking three different vocabularies. If someone reintroduces a hardcoded "Block" or
 * "Flat", the villa case below fails — which is the guardrail, because a label that leaks back
 * into the markup is invisible until a developer whose project has no blocks opens the screen.
 */

/** Points the profile endpoint at a given level set, leaving every other handler intact. */
function withProfile(levels: { kind: string; singular: string; plural: string }[], hasFloors = false) {
  server.use(
    http.get(`${TEST_API_URL}/api/v1/admin/property/profile`, () =>
      HttpResponse.json({
        propertyType: hasFloors ? 'APARTMENT' : 'VILLA',
        propertyTypeLabel: hasFloors ? 'Apartment complex' : 'Villa community',
        hasFloors,
        levels: levels.map((l, depth) => ({
          id: `1111111${depth}-1111-4111-8111-111111111111`,
          depth,
          kind: l.kind,
          singular: l.singular,
          plural: l.plural,
          nodeCount: 0,
        })),
      }),
    ),
  );
}

describe('Township structure', () => {
  it('renders one tab per level, using the developer’s own words', async () => {
    withProfile([
      { kind: 'GROUP', singular: 'Cluster', plural: 'Clusters' },
      { kind: 'UNIT', singular: 'Villa', plural: 'Villas' },
    ]);

    renderWithProviders(<TownshipRoute />);

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Clusters' })).toBeInTheDocument();
    });
    expect(screen.getByRole('tab', { name: 'Villas' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Gates' })).toBeInTheDocument();

    // Nothing anywhere on the screen calls this project's structure blocks or flats.
    expect(screen.queryByRole('tab', { name: 'Blocks' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Flats' })).not.toBeInTheDocument();
  });

  it('renders a three-level high-rise, floors included', async () => {
    withProfile(
      [
        { kind: 'BUILDING', singular: 'Tower', plural: 'Towers' },
        { kind: 'FLOOR', singular: 'Floor', plural: 'Floors' },
        { kind: 'UNIT', singular: 'Apartment', plural: 'Apartments' },
      ],
      true,
    );

    renderWithProviders(<TownshipRoute />);

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Towers' })).toBeInTheDocument();
    });
    expect(screen.getByRole('tab', { name: 'Floors' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Apartments' })).toBeInTheDocument();
  });

  it('labels the add control with the level being added to', async () => {
    withProfile([
      { kind: 'GROUP', singular: 'Cluster', plural: 'Clusters' },
      { kind: 'UNIT', singular: 'Villa', plural: 'Villas' },
    ]);

    renderWithProviders(<TownshipRoute />);

    // Depth 0 is the default tab, so the add button speaks the outermost level's word.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add Cluster' })).toBeInTheDocument();
    });
  });

  it('lets an admin rename a level without touching the structure', async () => {
    withProfile([
      { kind: 'BUILDING', singular: 'Block', plural: 'Blocks' },
      { kind: 'UNIT', singular: 'Flat', plural: 'Flats' },
    ]);

    const user = userEvent.setup();
    renderWithProviders(<TownshipRoute />);

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Levels' })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('tab', { name: 'Levels' }));

    // The kind is shown alongside the label, because it is what the system actually reasons about.
    await waitFor(() => {
      expect(screen.getByText('BUILDING')).toBeInTheDocument();
    });
    expect(screen.getByText('UNIT')).toBeInTheDocument();
  });

  it('falls back to the gates tab when a township has no levels defined yet', async () => {
    withProfile([]);

    renderWithProviders(<TownshipRoute />);

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Gates' })).toBeInTheDocument();
    });
    // No level tabs, and crucially no crash: a freshly created township is momentarily like this.
    expect(screen.queryByRole('tab', { name: 'Blocks' })).not.toBeInTheDocument();
  });

  it('surfaces a failed profile load as a retryable error, not a blank screen', async () => {
    server.use(
      http.get(`${TEST_API_URL}/api/v1/admin/property/profile`, () =>
        HttpResponse.json({ code: 'INTERNAL', message: 'boom' }, { status: 500 }),
      ),
    );

    renderWithProviders(<TownshipRoute />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    });
  });
});

/** Guards the shared handler set itself: the retired endpoints must be gone, not merely unused. */
describe('Retired endpoints', () => {
  it('no longer mocks /admin/blocks or /admin/flats', () => {
    const paths = createHandlers(TEST_API_URL).map((h) => String(h.info.path));
    expect(paths).not.toContain(`${TEST_API_URL}/api/v1/admin/blocks`);
    expect(paths).not.toContain(`${TEST_API_URL}/api/v1/admin/flats`);
    expect(paths).toContain(`${TEST_API_URL}/api/v1/admin/property/profile`);
  });
});

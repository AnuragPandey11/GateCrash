import { qk } from '@gatecrash/api';
import { IDS, apiError, insideVisitFixture } from '@gatecrash/api/mocks';
import { createFrameDispatcher } from '@gatecrash/realtime';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { OccupancyRoute } from '@/routes/occupancy';
import { renderWithProviders } from '@/test/render';
import { TEST_API_URL, server } from '@/test/server';

/**
 * Occupancy board — FRONTEND.md §8.3, and §12's **first non-negotiable test**:
 *
 * "**Socket-dead reconciliation.** With the STOMP client stubbed to never connect … the
 * resident's approvals list still populates."
 *
 * The admin-side equivalent is here. Note that `renderWithProviders` supplies **no**
 * `RealtimeProvider` at all, so every test in this file runs with a dead socket by construction
 * — the property is the default condition rather than one special case (guardrail #7).
 */
describe('occupancy board without a socket', () => {
  it('renders the count and the visitors from REST alone', async () => {
    renderWithProviders(<OccupancyRoute />);

    expect(await screen.findByText('1 person inside')).toBeInTheDocument();
    expect(screen.getByText('Suresh Iyer')).toBeInTheDocument();
    expect(screen.getByText('Main Gate')).toBeInTheDocument();
  });

  it('pluralises the count correctly', async () => {
    server.use(
      http.get(`${TEST_API_URL}/api/v1/admin/inside`, () =>
        HttpResponse.json({
          insideCount: 37,
          visits: [insideVisitFixture, { ...insideVisitFixture, id: IDS.visitPending }],
        }),
      ),
    );
    renderWithProviders(<OccupancyRoute />);

    expect(await screen.findByText('37 people inside')).toBeInTheDocument();
  });

  it('treats an empty board as a normal state, not an error', async () => {
    server.use(
      http.get(`${TEST_API_URL}/api/v1/admin/inside`, () =>
        HttpResponse.json({ insideCount: 0, visits: [] }),
      ),
    );
    renderWithProviders(<OccupancyRoute />);

    // A township with nobody inside at 3am is common and correct — the copy must not alarm.
    expect(await screen.findByText('Nobody is currently inside')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
  });

  it('shows an error with a retry when there is no cached data', async () => {
    server.use(
      http.get(`${TEST_API_URL}/api/v1/admin/inside`, () =>
        HttpResponse.json(apiError(500, 'INTERNAL_ERROR', 'boom'), { status: 500 }),
      ),
    );
    renderWithProviders(<OccupancyRoute />);

    expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('live updates', () => {
  const occupancyFrame = {
    type: 'OCCUPANCY_CHANGED',
    visitId: IDS.visitPending,
    status: 'CHECKED_IN',
    visitorName: 'Anjali Desai',
    gateName: 'Main Gate',
    insideCount: 2,
    at: '2026-07-23T14:40:00+05:30',
  } as const;

  it('writes the new count into the cache the instant the frame lands', async () => {
    const { queryClient } = renderWithProviders(<OccupancyRoute />);
    expect(await screen.findByText('1 person inside')).toBeInTheDocument();

    // Exactly what the RealtimeProvider does with a frame off /topic/admin/inside (§6.4).
    createFrameDispatcher(queryClient)(occupancyFrame as never);

    // `setQueryData` before any request goes out — this is the sub-second optic, asserted
    // synchronously so the refetch that follows cannot mask it.
    const cached = queryClient.getQueryData<{ insideCount: number; visits: unknown[] }>(
      qk.admin.inside,
    );
    expect(cached?.insideCount).toBe(2);
    // The existing rows survive: replacing them would re-mount the grid and make the board look
    // broken on every entry (§8.3).
    expect(cached?.visits).toHaveLength(1);
  });

  it('lets the server win once the invalidation lands', async () => {
    const { queryClient } = renderWithProviders(<OccupancyRoute />);
    await screen.findByText('1 person inside');

    server.use(
      http.get(`${TEST_API_URL}/api/v1/admin/inside`, () =>
        HttpResponse.json({
          insideCount: 2,
          visits: [insideVisitFixture, { ...insideVisitFixture, id: IDS.visitPending, visitorName: 'Anjali Desai' }],
        }),
      ),
    );

    createFrameDispatcher(queryClient)(occupancyFrame as never);

    // The frame is a head start, not the record. Postgres is the source of truth and the
    // invalidation is what reconciles against it (§6.4).
    await waitFor(() => expect(screen.getByText('2 people inside')).toBeInTheDocument());
    expect(screen.getByText('Anjali Desai')).toBeInTheDocument();
    expect(screen.getByText('Suresh Iyer')).toBeInTheDocument();
  });

  it('recovers the true count on the next fetch even if a frame was missed', async () => {
    const { queryClient } = renderWithProviders(<OccupancyRoute />);
    await screen.findByText('1 person inside');

    server.use(
      http.get(`${TEST_API_URL}/api/v1/admin/inside`, () =>
        HttpResponse.json({ insideCount: 9, visits: [insideVisitFixture] }),
      ),
    );
    // Reconciliation: frames that arrived while the socket was down are gone and nothing
    // replays them, so the REST fetch is the authority (§6.5).
    await queryClient.invalidateQueries({ queryKey: qk.admin.inside });

    await waitFor(() => expect(screen.getByText('9 people inside')).toBeInTheDocument());
  });
});

describe('filtering', () => {
  it('filters by visitor type without refetching', async () => {
    const user = userEvent.setup();
    server.use(
      http.get(`${TEST_API_URL}/api/v1/admin/inside`, () =>
        HttpResponse.json({
          insideCount: 2,
          visits: [
            insideVisitFixture,
            { ...insideVisitFixture, id: IDS.visitPending, visitorName: 'Anjali Desai', visitorType: 'GUEST' },
          ],
        }),
      ),
    );
    renderWithProviders(<OccupancyRoute />);
    await screen.findByText('Suresh Iyer');

    await user.click(screen.getByRole('button', { name: 'Guest', pressed: false }));

    expect(screen.getByText('Anjali Desai')).toBeInTheDocument();
    // The delivery visitor is filtered out client-side; the board is already fully loaded.
    expect(screen.queryByText('Suresh Iyer')).not.toBeInTheDocument();
  });

  it('searches by name and by flat', async () => {
    const user = userEvent.setup();
    renderWithProviders(<OccupancyRoute />);
    await screen.findByText('Suresh Iyer');

    const search = screen.getByLabelText('Search name or flat…');
    await user.type(search, 'A-101');
    expect(screen.getByText('Suresh Iyer')).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, 'nobody-by-this-name');
    expect(screen.getByText('No one inside matches this filter.')).toBeInTheDocument();
  });
});

describe('visitor cards', () => {
  it('shows how long each visitor has been inside', async () => {
    renderWithProviders(<OccupancyRoute />);
    const name = await screen.findByText('Suresh Iyer');
    const card = name.closest('div[class*="rounded-lg"]') as HTMLElement;

    // Computed from the server's `checkedInAt`, never a client-side stopwatch (§8.3).
    expect(within(card).getByText(/^Inside for /)).toBeInTheDocument();
  });
});

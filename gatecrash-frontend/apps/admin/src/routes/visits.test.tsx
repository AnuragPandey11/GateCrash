import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { VisitsRoute } from '@/routes/visits';
import { renderWithProviders } from '@/test/render';
import { TEST_API_URL, server } from '@/test/server';

/**
 * Both paths render the same screen; `/visits/:visitId` additionally opens the drawer. Mounting
 * the real route pair matters here — the drawer reads its id from `useParams`, so a bare render
 * of the component would never open it.
 */
const routes = (
  <Routes>
    <Route path="/visits" element={<VisitsRoute />} />
    <Route path="/visits/:visitId" element={<VisitsRoute />} />
  </Routes>
);

/**
 * The visitor log — FRONTEND.md §8.4.
 *
 * The property worth testing is that **filters live in the URL**: an admin has to be able to
 * send a colleague a link to "all rejected visits at the service gate last Tuesday", and that
 * only works if the query string is the source of truth.
 */
describe('the log', () => {
  it('lists visits with their status', async () => {
    renderWithProviders(routes, { route: '/visits' });

    expect(await screen.findByText('Suresh Iyer')).toBeInTheDocument();
    expect(screen.getByText('Inside')).toBeInTheDocument();
    expect(screen.getByText('Waiting for approval')).toBeInTheDocument();
  });

  it('reads its filters out of the URL, so a shared link reproduces the view', async () => {
    let received: URLSearchParams | null = null;
    server.use(
      http.get(`${TEST_API_URL}/api/v1/admin/visits`, ({ request }) => {
        received = new URL(request.url).searchParams;
        return HttpResponse.json({
          content: [],
          page: 0,
          size: 50,
          totalElements: 0,
          totalPages: 0,
          first: true,
          last: true,
        });
      }),
    );

    renderWithProviders(routes, {
      route: '/visits?status=REJECTED&gateId=5555aaaa-5555-4555-8555-555555555555',
    });

    await waitFor(() => expect(received).not.toBeNull());
    expect(received!.get('status')).toBe('REJECTED');
    expect(received!.get('gateId')).toBe('5555aaaa-5555-4555-8555-555555555555');
    // Zero-based on the wire, one-based in the UI — converted in exactly one place (§4.4).
    expect(received!.get('page')).toBe('0');
    expect(received!.get('size')).toBe('50');
    expect(received!.get('sort')).toBe('createdAt,desc');
  });

  it('never sends a blank filter, which Spring would reject as TYPE_MISMATCH', async () => {
    let received: URLSearchParams | null = null;
    server.use(
      http.get(`${TEST_API_URL}/api/v1/admin/visits`, ({ request }) => {
        received = new URL(request.url).searchParams;
        return HttpResponse.json({
          content: [],
          page: 0,
          size: 50,
          totalElements: 0,
          totalPages: 0,
          first: true,
          last: true,
        });
      }),
    );

    renderWithProviders(routes, { route: '/visits' });

    await waitFor(() => expect(received).not.toBeNull());
    expect(received!.has('status')).toBe(false);
    expect(received!.has('visitorType')).toBe(false);
    expect(received!.has('from')).toBe(false);
  });

  it('shows a plain empty state when nothing matches', async () => {
    server.use(
      http.get(`${TEST_API_URL}/api/v1/admin/visits`, () =>
        HttpResponse.json({
          content: [],
          page: 0,
          size: 50,
          totalElements: 0,
          totalPages: 0,
          first: true,
          last: true,
        }),
      ),
    );
    renderWithProviders(routes, { route: '/visits' });

    expect(await screen.findByText('No visits match these filters.')).toBeInTheDocument();
  });
});

describe('the detail drawer', () => {
  it('opens from the route, so it is deep-linkable', async () => {
    renderWithProviders(routes, {
      route: '/visits/8888aaaa-8888-4888-8888-888888888888',
    });

    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText('Visit detail')).toBeInTheDocument();
    // The drawer opens immediately and fills from `GET /visits/{id}` — it renders a loading
    // state first rather than blocking the route transition on the fetch.
    expect(await within(drawer).findByText('Suresh Iyer')).toBeInTheDocument();
    // The timeline is assembled from the timestamp fields — there is no event log endpoint.
    expect(within(drawer).getByText('Logged at the gate')).toBeInTheDocument();
    expect(within(drawer).getByText('Entered')).toBeInTheDocument();
  });

  it('says so plainly when there is no gate photo', async () => {
    renderWithProviders(routes, {
      route: '/visits/8888aaaa-8888-4888-8888-888888888888',
    });

    const drawer = await screen.findByRole('dialog');
    // Photo capture is blocked until the upload endpoint lands (§15.1), so this is the only
    // outcome today — better said out loud than shown as a broken image frame.
    expect(await within(drawer).findByText('No photo captured')).toBeInTheDocument();
  });

  it('opens a row with the keyboard, not just the mouse', async () => {
    const user = userEvent.setup();
    renderWithProviders(routes, { route: '/visits' });
    await screen.findByText('Suresh Iyer');

    const row = screen.getByText('Suresh Iyer').closest('tr') as HTMLElement;
    row.focus();
    await user.keyboard('{Enter}');

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });
});

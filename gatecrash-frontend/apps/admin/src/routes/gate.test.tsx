import { gatesFixture, insideVisitFixture } from '@gatecrash/api/mocks';
import type { GateId } from '@gatecrash/core';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { useGateStore } from '@/lib/gate';
import { ADMIN_SESSION, renderWithProviders } from '@/test/render';
import { server, TEST_API_URL } from '@/test/server';
import { GateRoute } from './gate';

const GUARD_SESSION = { ...ADMIN_SESSION, role: 'GUARD' as const, loginId: 'guard-01', fullName: 'Gate Guard' };

/**
 * Regression: "Walk-in does nothing". The walk-in form is the console's opening tab, so the
 * button that merely switched to that tab changed nothing on screen. It must take the guard to
 * the form and put the cursor in the visitor's name.
 */
describe('gate console — Walk-in', () => {
  beforeEach(() => {
    useGateStore.getState().setGate(gatesFixture[0]!.id as GateId);
  });

  it('puts the cursor in the visitor name on the opening tab', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GateRoute />, { session: GUARD_SESSION });

    await user.click(await screen.findByRole('button', { name: 'Walk-in' }));

    await waitFor(() => expect(screen.getByLabelText(/^Visitor name/)).toHaveFocus());
  });

  it('lists visitors who came in at another gate, and checks them out at this one', async () => {
    // This console is at the Service Gate; the visitor in the fixture came in at the Main Gate.
    useGateStore.getState().setGate(gatesFixture[1]!.id as GateId);
    const sent: unknown[] = [];
    server.use(
      http.patch(`${TEST_API_URL}/api/v1/visits/:id/check-out`, async ({ request }) => {
        sent.push(await request.json());
        return HttpResponse.json({ ...insideVisitFixture, status: 'CHECKED_OUT', exitGateName: 'Service Gate' });
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<GateRoute />, { session: GUARD_SESSION });

    await user.click(await screen.findByRole('radio', { name: /^Inside · 1/ }));
    expect(await screen.findByText('Came in at Main Gate')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Check out' }));
    await waitFor(() => expect(sent).toEqual([{ gateId: gatesFixture[1]!.id }]));
  });

  it('brings the form back from another tab', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GateRoute />, { session: GUARD_SESSION });

    await user.click(await screen.findByRole('radio', { name: /^At the gate/ }));
    expect(screen.queryByText('Ask the resident', { exact: false })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Walk-in' }));

    await waitFor(() => expect(screen.getByLabelText(/^Visitor name/)).toHaveFocus());
  });
});

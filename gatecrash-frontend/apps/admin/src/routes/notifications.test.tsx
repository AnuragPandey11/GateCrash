import { apiError } from '@gatecrash/api/mocks';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { NotificationsRoute } from '@/routes/notifications';
import { renderWithProviders } from '@/test/render';
import { TEST_API_URL, server } from '@/test/server';

/**
 * The notification composer — FRONTEND.md §8.5.
 *
 * These tests exist because this screen makes thousands of phones buzz with no undo. The
 * property worth protecting is not "the form works" but "**nobody can send a rule whose blast
 * radius was never shown to them**".
 */

async function fillMessage(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/^Title/), 'Water supply interruption');
  await user.type(screen.getByLabelText(/^Message/), 'Water will be off in Block A on Tuesday.');
}

describe('send gating', () => {
  it('keeps Send disabled until the preview resolves for the current rule', async () => {
    const user = userEvent.setup();
    renderWithProviders(<NotificationsRoute />);

    await fillMessage(user);

    // Once the debounced preview lands, the button carries the count — which is the whole
    // point: an admin clicks "Send to 312 people", not "Send".
    const send = await screen.findByRole('button', { name: 'Send to 312 people' }, { timeout: 3000 });
    expect(send).toBeEnabled();
  });

  it('will not send with an empty title or body', async () => {
    const user = userEvent.setup();
    renderWithProviders(<NotificationsRoute />);

    await user.type(screen.getByLabelText(/^Title/), 'Only a title');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^Send/ })).toBeDisabled(),
    );
  });

  it('refuses a ROLES rule with nothing ticked, and says why', async () => {
    const user = userEvent.setup();
    renderWithProviders(<NotificationsRoute />);
    await fillMessage(user);

    await user.click(screen.getByRole('radio', { name: /^By role/ }));

    expect(await screen.findByText('Pick at least one role.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Send/ })).toBeDisabled();
  });

  it('re-enables Send once a role is picked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<NotificationsRoute />);
    await fillMessage(user);

    await user.click(screen.getByRole('radio', { name: /^By role/ }));
    await user.click(screen.getByRole('checkbox', { name: 'Resident' }));

    await waitFor(
      () => expect(screen.getByRole('button', { name: /^Send to /})).toBeEnabled(),
      { timeout: 3000 },
    );
  });
});

describe('confirmation', () => {
  it('restates the count and warns there is no unsend', async () => {
    const user = userEvent.setup();
    renderWithProviders(<NotificationsRoute />);
    await fillMessage(user);

    await user.click(await screen.findByRole('button', { name: 'Send to 312 people' }, { timeout: 3000 }));

    expect(await screen.findByText('Send this announcement?')).toBeInTheDocument();
    expect(screen.getByText(/no way to unsend it/i)).toBeInTheDocument();
    expect(screen.getByText(/312 people on 468 devices/)).toBeInTheDocument();
  });

  it('sends only after the second, explicit click', async () => {
    const user = userEvent.setup();
    const sent = vi.fn();
    server.use(
      http.post(`${TEST_API_URL}/api/v1/notifications`, async ({ request }) => {
        sent(await request.json());
        return HttpResponse.json({ id: 'x', status: 'QUEUED' }, { status: 201 });
      }),
    );

    renderWithProviders(<NotificationsRoute />);
    await fillMessage(user);
    await user.click(await screen.findByRole('button', { name: 'Send to 312 people' }, { timeout: 3000 }));

    // Opening the dialog must not have sent anything.
    expect(sent).not.toHaveBeenCalled();

    const dialog = await screen.findByRole('dialog');
    await user.click(await within2(dialog, 'Send to 312 people'));

    await waitFor(() => expect(sent).toHaveBeenCalledOnce());
    expect(sent.mock.calls[0]?.[0]).toMatchObject({
      title: 'Water supply interruption',
      audienceRule: { mode: 'ALL' },
    });
  });

  it('cancelling sends nothing', async () => {
    const user = userEvent.setup();
    const sent = vi.fn();
    server.use(
      http.post(`${TEST_API_URL}/api/v1/notifications`, async () => {
        sent();
        return HttpResponse.json({}, { status: 201 });
      }),
    );

    renderWithProviders(<NotificationsRoute />);
    await fillMessage(user);
    await user.click(await screen.findByRole('button', { name: 'Send to 312 people' }, { timeout: 3000 }));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(sent).not.toHaveBeenCalled();
  });
});

describe('audience rule construction', () => {
  it('never carries a list from a mode the admin switched away from', async () => {
    const user = userEvent.setup();
    const previews: unknown[] = [];
    server.use(
      http.post(`${TEST_API_URL}/api/v1/notifications/preview`, async ({ request }) => {
        const rule = await request.json();
        previews.push(rule);
        return HttpResponse.json({ recipientCount: 12, deviceCount: 18 });
      }),
    );

    renderWithProviders(<NotificationsRoute />);
    await fillMessage(user);

    await user.click(screen.getByRole('radio', { name: /^Specific/ }));
    await user.click(await screen.findByRole('checkbox', { name: 'Block A' }));
    await waitFor(
      () => {
        const last = previews[previews.length - 1] as Record<string, unknown> | undefined;
        expect(last?.mode).toBe('NODES');
      },
      { timeout: 3000 },
    );

    await user.click(screen.getByRole('radio', { name: /^Everyone/ }));
    await waitFor(
      () => {
        const last = previews[previews.length - 1] as Record<string, unknown>;
        expect(last).toEqual({ mode: 'ALL' });
      },
      { timeout: 3000 },
    );
    // A stale nodeIds reaching the resolver would blast an audience nobody reviewed (§4.3.1).
  });

  it('sends a whole building as one node id, not its flats', async () => {
    const user = userEvent.setup();
    const previews: Record<string, unknown>[] = [];
    server.use(
      http.post(`${TEST_API_URL}/api/v1/notifications/preview`, async ({ request }) => {
        previews.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ recipientCount: 2, deviceCount: 2 });
      }),
    );

    renderWithProviders(<NotificationsRoute />);
    await fillMessage(user);
    await user.click(screen.getByRole('radio', { name: /^Specific/ }));
    await user.click(await screen.findByRole('checkbox', { name: 'Block A' }));

    await waitFor(
      () => {
        const last = previews[previews.length - 1];
        expect(last?.mode).toBe('NODES');
        expect(last?.nodeIds).toHaveLength(1);
      },
      { timeout: 3000 },
    );
    expect(screen.getByText(/Covers 2 flats/)).toBeInTheDocument();
  });

  it('offers templates only while the message is empty', async () => {
    const user = userEvent.setup();
    renderWithProviders(<NotificationsRoute />);

    await user.click(screen.getByRole('button', { name: 'Electricity bill' }));

    expect(screen.getByLabelText(/^Title/)).toHaveValue('Electricity bill due');
    // Once there is a message, picking another template could overwrite it — so they go away.
    expect(screen.queryByRole('button', { name: 'Water supply' })).not.toBeInTheDocument();
  });
});

describe('failures', () => {
  it('keeps the form filled when the send fails', async () => {
    const user = userEvent.setup();
    server.use(
      http.post(`${TEST_API_URL}/api/v1/notifications`, () =>
        HttpResponse.json(apiError(500, 'INTERNAL_ERROR', 'boom'), { status: 500 }),
      ),
    );

    renderWithProviders(<NotificationsRoute />);
    await fillMessage(user);
    await user.click(await screen.findByRole('button', { name: 'Send to 312 people' }, { timeout: 3000 }));
    const dialog = await screen.findByRole('dialog');
    await user.click(await within2(dialog, 'Send to 312 people'));

    // §11.1: never clear user input on error. Retyping a 2000-character announcement is not an
    // acceptable cost for a 500.
    await waitFor(() =>
      expect(screen.getByLabelText(/^Title/)).toHaveValue('Water supply interruption'),
    );
    expect(await screen.findByText(/unexpected problem/i)).toBeInTheDocument();
  });
});

/** Find a button by name within a container (the dialog has a same-named trigger behind it). */
async function within2(container: HTMLElement, name: string): Promise<HTMLElement> {
  const buttons = [...container.querySelectorAll('button')];
  const match = buttons.find((b) => b.textContent?.includes(name));
  if (!match) throw new Error(`No button matching "${name}" in dialog`);
  return match;
}

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AudienceRule } from '@gatecrash/core';
import { http, HttpResponse } from 'msw';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { server, TEST_API_URL } from '@/test/server';
import { AudienceBuilder } from './audience-builder';

const PEOPLE = [
  { id: '11111111-1111-4111-8111-111111111111', fullName: 'Asha Rao', loginId: 'A-101-1', role: 'RESIDENT', sales: false, unitCode: 'A-101' },
  { id: '22222222-2222-4222-8222-222222222222', fullName: 'Ravi Kumar', loginId: 'A-102-1', role: 'RESIDENT', sales: false, unitCode: 'A-102' },
  { id: '33333333-3333-4333-8333-333333333333', fullName: 'Gate Guard', loginId: 'guard-01', role: 'GUARD', sales: false },
];

let latest: AudienceRule = { mode: 'USERS', userIds: [] };

function Harness() {
  const [rule, setRule] = useState<AudienceRule>({ mode: 'USERS', userIds: [] });
  latest = rule;
  return <AudienceBuilder rule={rule} onChange={setRule} error={null} />;
}

describe('people picker under "Everyone"', () => {
  it('starts folded with nobody ticked; groups open with their arrow', async () => {
    server.use(http.get(`${TEST_API_URL}/api/v1/notifications/audience-users`, () => HttpResponse.json(PEOPLE)));
    const user = userEvent.setup();
    renderWithProviders(<Harness />);

    const residents = await screen.findByRole('button', { name: /Residents/ });
    expect(residents).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('Ravi Kumar')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Select all')).toHaveAttribute('data-state', 'unchecked');
    expect(screen.getByText('0 of 3 selected')).toBeInTheDocument();

    await user.click(residents);
    expect(residents).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Ravi Kumar')).toHaveAttribute('data-state', 'unchecked');
    // The guards group is still folded.
    expect(screen.queryByLabelText('Gate Guard')).not.toBeInTheDocument();
  });

  it('ticking people, a group or Select all builds the matching rule', async () => {
    server.use(http.get(`${TEST_API_URL}/api/v1/notifications/audience-users`, () => HttpResponse.json(PEOPLE)));
    const user = userEvent.setup();
    renderWithProviders(<Harness />);

    await user.click(await screen.findByRole('button', { name: /Residents/ }));
    await user.click(screen.getByLabelText('Ravi Kumar'));
    expect(latest).toEqual({ mode: 'USERS', userIds: [PEOPLE[1]!.id] });

    await user.click(screen.getByLabelText('Guards'));
    expect([...(latest.userIds ?? [])].sort()).toEqual([PEOPLE[1]!.id, PEOPLE[2]!.id]);
    expect(screen.getByLabelText('Select all')).toHaveAttribute('data-state', 'indeterminate');

    await user.click(screen.getByLabelText('Select all'));
    expect(latest).toEqual({ mode: 'ALL' });

    await user.click(screen.getByLabelText('Select all'));
    expect(latest).toEqual({ mode: 'USERS', userIds: [] });
  });

  it('a search opens the groups that match', async () => {
    server.use(http.get(`${TEST_API_URL}/api/v1/notifications/audience-users`, () => HttpResponse.json(PEOPLE)));
    const user = userEvent.setup();
    renderWithProviders(<Harness />);

    await user.type(await screen.findByLabelText('Search name, login or home'), 'guard');
    expect(screen.getByLabelText('Gate Guard')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Residents/ })).not.toBeInTheDocument();
  });
});

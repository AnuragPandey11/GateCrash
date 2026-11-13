import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { AppRoutes } from '@/routes';
import { renderWithProviders } from '@/test/render';

afterEach(() => {
  localStorage.removeItem('gc.sidebar.collapsed');
});

describe('collapsible sidebar', () => {
  it('keeps nav links styled and centred in the collapsed rail', async () => {
    localStorage.setItem('gc.sidebar.collapsed', 'true');
    renderWithProviders(<AppRoutes />, { route: '/occupancy' });

    // Regression: the tooltip trigger used to flatten NavLink's className function into a
    // string, leaving the links unstyled and off-centre against the logo.
    const links = await screen.findAllByRole('link', { name: 'Visitor log' });
    const railLink = links.find((link) => link.className.includes('justify-center'));
    expect(railLink).toBeDefined();
    expect(railLink?.className).not.toContain('=>');
  });

  it('collapses and expands from the top-bar button, keeping link names for screen readers', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />, { route: '/occupancy' });

    await user.click(await screen.findByRole('button', { name: 'Collapse sidebar' }));
    expect(localStorage.getItem('gc.sidebar.collapsed')).toBe('true');
    expect(screen.getAllByRole('link', { name: 'Visitor log' }).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(localStorage.getItem('gc.sidebar.collapsed')).toBe('false');
  });
});

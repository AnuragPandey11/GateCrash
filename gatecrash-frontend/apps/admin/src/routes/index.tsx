import { usesAdminWeb } from '@gatecrash/core';
import { Loader2 } from 'lucide-react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/app-shell';
import { RouteErrorBoundary } from '@/components/error-boundary';
import { useSessionStore } from '@/lib/session';
import { ChangePasswordRoute } from './change-password';
import { CommunityRoute } from './community';
import { LoginRoute } from './login';
import { NotFoundRoute } from './not-found';
import { NotificationsRoute } from './notifications';
import { OccupancyRoute } from './occupancy';
import { TownshipRoute } from './township';
import { UsersRoute } from './users';
import { VisitsRoute } from './visits';
import { WrongSurfaceRoute } from './wrong-surface';

/**
 * Routing and guards — FRONTEND.md §8.2.
 *
 * Route guards are **UX, not security** (guardrail #4). Every screen behind them calls a server
 * endpoint that re-checks the role; hiding a nav item has never stopped anyone. What the guards
 * buy is a coherent app: a resident who opens the web URL gets an explanation instead of a wall
 * of 403s, and an admin mid-password-reset gets the one screen that works instead of six that
 * do not.
 *
 * The `mustResetPassword` branch is the load-bearing one. It is checked *before* the role branch
 * and before every app route, because `PasswordResetEnforcementFilter` will reject everything
 * else anyway — §12's "password-reset lockout" test asserts exactly this.
 */
export function AppRoutes() {
  const state = useSessionStore((s) => s.state);
  const role = useSessionStore((s) => s.me?.role ?? null);

  if (state === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg">
        <Loader2 className="size-6 animate-spin text-text-muted" aria-label="Loading" />
      </div>
    );
  }

  if (state === 'unauthenticated') {
    return (
      <Routes>
        <Route path="/login" element={<LoginRoute />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  // Before the role check: a non-admin still has to be able to clear their forced reset, and the
  // change-password endpoint is one of the four the filter allows.
  if (state === 'mustResetPassword') {
    return (
      <Routes>
        <Route path="/change-password" element={<ChangePasswordRoute />} />
        <Route path="*" element={<Navigate to="/change-password" replace />} />
      </Routes>
    );
  }

  if (role && !usesAdminWeb(role)) {
    return (
      <Routes>
        <Route path="*" element={<WrongSurfaceRoute />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/occupancy" replace />} />
        <Route
          path="/occupancy"
          element={
            <RouteErrorBoundary>
              <OccupancyRoute />
            </RouteErrorBoundary>
          }
        />
        {/* `/visits/:id` renders the same screen with a detail drawer, so the drawer is
            deep-linkable and the table behind it keeps its filters (§8.4). */}
        <Route
          path="/visits"
          element={
            <RouteErrorBoundary>
              <VisitsRoute />
            </RouteErrorBoundary>
          }
        />
        <Route
          path="/visits/:visitId"
          element={
            <RouteErrorBoundary>
              <VisitsRoute />
            </RouteErrorBoundary>
          }
        />
        <Route
          path="/notifications"
          element={
            <RouteErrorBoundary>
              <NotificationsRoute />
            </RouteErrorBoundary>
          }
        />
        <Route
          path="/community"
          element={
            <RouteErrorBoundary>
              <CommunityRoute />
            </RouteErrorBoundary>
          }
        />
        <Route
          path="/users"
          element={
            <RouteErrorBoundary>
              <UsersRoute />
            </RouteErrorBoundary>
          }
        />
        <Route
          path="/township"
          element={
            <RouteErrorBoundary>
              <TownshipRoute />
            </RouteErrorBoundary>
          }
        />
        <Route path="/login" element={<Navigate to="/occupancy" replace />} />
        {/* Reachable when an admin changes their password voluntarily. */}
        <Route path="/change-password" element={<ChangePasswordRoute />} />
        <Route path="*" element={<NotFoundRoute />} />
      </Route>
    </Routes>
  );
}

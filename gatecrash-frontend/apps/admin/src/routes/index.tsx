import { isPlatformOperator, usesAdminWeb } from '@gatecrash/core';
import { Loader2 } from 'lucide-react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/app-shell';
import { homeFor } from '@/components/nav-config';
import { RouteErrorBoundary } from '@/components/error-boundary';
import { useSessionStore } from '@/lib/session';
import { AmenitiesRoute } from './amenities';
import { BillingRoute } from './billing';
import { BillsRoute } from './bills';
import { ChangePasswordRoute } from './change-password';
import { CommunityRoute } from './community';
import { GateRoute } from './gate';
import { HomeRoute } from './home';
import { InboxRoute } from './inbox';
import { LoginRoute } from './login';
import { NotFoundRoute } from './not-found';
import { NotificationsRoute } from './notifications';
import { MovesRoute } from './moves';
import { OccupancyRoute } from './occupancy';
import { PassesRoute } from './passes';
import { RulesRoute } from './rules';
import { StaffRoute } from './staff';
import { SupportRoute } from './support';
import { TownshipRoute } from './township';
import { TownshipsRoute } from './townships';
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
 *
 * The super-admin branch is the same idea one level down. A `SUPER_ADMIN` belongs to no township,
 * so every township-scoped endpoint answers `422 TOWNSHIP_CONTEXT_REQUIRED` until one is selected
 * — landing them on an occupancy board that cannot load would read as a broken app rather than as
 * a missing choice. They go to the console instead, and the township-scoped routes stay
 * unreachable until they pick one.
 */
export function AppRoutes() {
  const state = useSessionStore((s) => s.state);
  const role = useSessionStore((s) => s.me?.role ?? null);
  const actingTownshipId = useSessionStore((s) => s.actingTownshipId);
  const sales = useSessionStore((s) => s.me?.sales ?? false);

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

  const platformOperator = role ? isPlatformOperator(role) : false;
  const townshipSelected = !platformOperator || Boolean(actingTownshipId);
  const home = role ? homeFor(role, townshipSelected) : '/login';
  const office = role === 'ADMIN' || (role === 'SUPER_ADMIN' && townshipSelected);

  // Only the screens this role has are *defined* — not hidden. React Router ranks by specificity,
  // so a defined `/occupancy` would beat the catch-all below and load a screen whose every request
  // the server refuses. Not defining it is what makes the catch-all the only match.
  const screens: { path: string; element: React.ReactNode }[] = [];
  if (platformOperator) screens.push({ path: '/townships', element: <TownshipsRoute /> });
  if (office) {
    screens.push(
      { path: '/occupancy', element: <OccupancyRoute /> },
      // `/visits/:id` renders the same screen with a detail drawer, so the drawer is deep-linkable
      // and the table behind it keeps its filters (§8.4).
      { path: '/visits', element: <VisitsRoute /> },
      { path: '/visits/:visitId', element: <VisitsRoute /> },
      { path: '/notifications', element: <NotificationsRoute /> },
      { path: '/inbox', element: <InboxRoute /> },
      { path: '/community', element: <CommunityRoute /> },
      { path: '/users', element: <UsersRoute /> },
      { path: '/township', element: <TownshipRoute /> },
      { path: '/helpdesk', element: <SupportRoute office /> },
      { path: '/amenities', element: <AmenitiesRoute office /> },
      { path: '/moves', element: <MovesRoute office /> },
      { path: '/billing', element: <BillingRoute /> },
      { path: '/rules', element: <RulesRoute office /> },
      { path: '/staff', element: <StaffRoute office /> },
    );
  }
  if (role === 'GUARD') {
    screens.push(
      { path: '/gate', element: <GateRoute /> },
      // The visitor log, read-only for guards (no export): they log and admit these visitors.
      { path: '/visits', element: <VisitsRoute /> },
      { path: '/visits/:visitId', element: <VisitsRoute /> },
      { path: '/inbox', element: <InboxRoute /> },
      { path: '/community', element: <CommunityRoute readOnly /> },
    );
  }
  if (role === 'RESIDENT') {
    screens.push(
      { path: '/home', element: <HomeRoute /> },
      { path: '/inbox', element: <InboxRoute /> },
      { path: '/passes', element: <PassesRoute /> },
      { path: '/community', element: <CommunityRoute readOnly /> },
      { path: '/bills', element: <BillsRoute /> },
      { path: '/support', element: <SupportRoute /> },
      { path: '/amenities', element: <AmenitiesRoute /> },
      { path: '/moves', element: <MovesRoute /> },
      { path: '/rules', element: <RulesRoute /> },
      { path: '/helpers', element: <StaffRoute /> },
    );
  }
  if (sales && (role === 'ADMIN' || role === 'GUARD')) {
    screens.push({ path: '/approvals', element: <HomeRoute salesMode /> });
  }

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to={home} replace />} />
        {screens.map(({ path, element }) => (
          <Route key={path} path={path} element={<RouteErrorBoundary>{element}</RouteErrorBoundary>} />
        ))}
        <Route path="/login" element={<Navigate to={home} replace />} />
        {/* Reachable when anyone changes their password voluntarily. */}
        <Route path="/change-password" element={<ChangePasswordRoute />} />
        <Route
          path="*"
          element={townshipSelected ? <NotFoundRoute /> : <Navigate to="/townships" replace />}
        />
      </Route>
    </Routes>
  );
}

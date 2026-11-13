import { HttpResponse, http, type HttpHandler } from 'msw';
import {
  IDS,
  TOWNSHIP_CODE,
  apiError,
  blocksFixture,
  flatsFixture,
  occupancySummaryFixture,
  propertyProfileFixture,
  propertyTypesFixture,
  gatesFixture,
  insideVisitFixture,
  loginResponseFixture,
  meResponseFixture,
  notificationFixture,
  page,
  pendingVisitFixture,
  postFixture,
  superAdminLoginResponseFixture,
  usersFixture,
  townshipFixture,
  archivedTownshipFixture,
} from './fixtures';

/**
 * Shared MSW handlers — FRONTEND.md §12.
 *
 * These live in `packages/api` and are consumed by both apps deliberately: a contract change then
 * breaks *one* set of mocks, not two, and the break shows up as a failing test rather than as a
 * screen that silently renders the old shape.
 *
 * The default handlers describe the happy path. Error cases are opt-in per test via the
 * `errorHandlers` helpers below, so a test that wants a `409` says so in one line rather than
 * rebuilding the whole handler set.
 */

export const DEFAULT_API_URL = 'http://localhost:8080';

const url = (path: string, base = DEFAULT_API_URL) => `${base}/api/v1${path}`;

export function createHandlers(base = DEFAULT_API_URL): HttpHandler[] {
  return [
    // ── Auth ────────────────────────────────────────────────────────────────────────────────
    http.post(url('/auth/login', base), async ({ request }) => {
      const body = (await request.json()) as {
        townshipCode?: string;
        loginId: string;
        password: string;
      };
      if (body.password === 'wrong') {
        return HttpResponse.json(
          apiError(401, 'UNAUTHORIZED', 'Invalid login id or password.'),
          { status: 401 },
        );
      }
      if (body.loginId === 'lockedout') {
        return HttpResponse.json(
          apiError(429, 'TOO_MANY_REQUESTS', 'Too many failed attempts. Try again in 15 minutes.'),
          { status: 429 },
        );
      }
      // A missing township code resolves the tenantless platform namespace, which is where the
      // super admins live — the same branch `AuthService.resolveAccount` takes.
      if (!body.townshipCode) {
        return HttpResponse.json({
          ...superAdminLoginResponseFixture,
          mustResetPassword: body.loginId === 'mustreset',
        });
      }
      if (body.townshipCode.toUpperCase() !== TOWNSHIP_CODE) {
        // An unknown township is deliberately indistinguishable from a wrong password.
        return HttpResponse.json(
          apiError(401, 'UNAUTHORIZED', 'Invalid login id or password.'),
          { status: 401 },
        );
      }
      if (body.loginId === 'suspended') {
        return HttpResponse.json(
          apiError(403, 'TOWNSHIP_INACTIVE',
            'This township is not currently active. Contact your administrator.'),
          { status: 403 },
        );
      }
      return HttpResponse.json({
        ...loginResponseFixture,
        mustResetPassword: body.loginId === 'mustreset',
      });
    }),

    http.post(url('/auth/refresh', base), async ({ request }) => {
      const body = (await request.json()) as { refreshToken: string };
      if (body.refreshToken === 'revoked') {
        return HttpResponse.json(
          apiError(401, 'UNAUTHORIZED', 'Refresh token is not valid.'),
          { status: 401 },
        );
      }
      // Rotation: a new refresh token every time, exactly as the backend does.
      return HttpResponse.json({
        ...loginResponseFixture,
        accessToken: `access-${Date.now()}`,
        refreshToken: `refresh-${Date.now()}`,
      });
    }),

    http.post(url('/auth/password', base), () =>
      // Returns a full LoginResponse with fresh tokens — §5.3's trap.
      HttpResponse.json({
        ...loginResponseFixture,
        accessToken: 'access-after-password-change',
        refreshToken: 'refresh-after-password-change',
        mustResetPassword: false,
      }),
    ),

    http.post(url('/auth/logout', base), () => new HttpResponse(null, { status: 204 })),
    http.get(url('/auth/me', base), () => HttpResponse.json(meResponseFixture)),

    // ── Visits ──────────────────────────────────────────────────────────────────────────────
    http.get(url('/visits/pending', base), () => HttpResponse.json([pendingVisitFixture])),
    http.get(url('/visits/mine', base), () => HttpResponse.json(page([], { size: 20 }))),
    http.get(url('/move-requests/today', base), () => HttpResponse.json([])),
    http.get(url('/amenities', base), () => HttpResponse.json([])),
    http.get(url('/amenity-bookings/mine', base), () => HttpResponse.json([])),
    http.get(url('/support-tickets/mine', base), () => HttpResponse.json(page([], { size: 20 }))),
    http.get(url('/invoices/mine', base), () => HttpResponse.json(page([], { size: 20 }))),
    http.get(url('/move-requests/mine', base), () => HttpResponse.json([])),
    http.get(url('/visits/gate/:gateId', base), () =>
      HttpResponse.json([insideVisitFixture, pendingVisitFixture]),
    ),
    http.get(url('/visits/:id', base), ({ params }) =>
      HttpResponse.json(
        params.id === IDS.visitInside ? insideVisitFixture : pendingVisitFixture,
      ),
    ),
    http.post(url('/visits', base), () => HttpResponse.json(pendingVisitFixture, { status: 201 })),
    http.patch(url('/visits/:id/decision', base), async ({ request }) => {
      const body = (await request.json()) as { decision: 'APPROVED' | 'REJECTED' };
      return HttpResponse.json({
        ...pendingVisitFixture,
        status: body.decision,
        decidedAt: '2026-07-23T14:31:00+05:30',
        approverName: 'Ravi Kumar',
      });
    }),
    http.patch(url('/visits/:id/check-in', base), () =>
      HttpResponse.json({ ...insideVisitFixture, status: 'CHECKED_IN' }),
    ),
    http.patch(url('/visits/:id/check-out', base), () =>
      HttpResponse.json({
        ...insideVisitFixture,
        status: 'CHECKED_OUT',
        checkedOutAt: '2026-07-23T16:02:00+05:30',
      }),
    ),

    // ── Admin ops ───────────────────────────────────────────────────────────────────────────
    http.get(url('/admin/inside', base), () =>
      HttpResponse.json({ insideCount: 1, visits: [insideVisitFixture] }),
    ),
    http.get(url('/admin/visits', base), () =>
      HttpResponse.json(page([insideVisitFixture, pendingVisitFixture], { size: 50 })),
    ),

    http.get(url('/admin/users', base), () => HttpResponse.json(page(usersFixture))),
    http.get(url('/admin/users/:id', base), () => HttpResponse.json(usersFixture[0])),
    http.post(url('/admin/users', base), async ({ request }) => {
      const body = (await request.json()) as { fullName: string; role: string; loginId?: string };
      return HttpResponse.json(
        {
          id: IDS.sales,
          loginId: body.loginId ?? 'A-101-2',
          fullName: body.fullName,
          role: body.role,
          generatedPassword: 'Xk4p-Qm82-Tz19',
        },
        { status: 201 },
      );
    }),
    http.post(url('/admin/users/:id/reset-password', base), ({ params }) =>
      HttpResponse.json({
        id: params.id,
        loginId: 'A-101-1',
        generatedPassword: 'Nb7v-Rd45-Lq03',
      }),
    ),
    http.patch(url('/admin/users/:id', base), async ({ request }) => {
      const body = (await request.json()) as Record<string, string>;
      return HttpResponse.json({ ...usersFixture[0], ...body });
    }),
    http.delete(url('/admin/users/:id', base), () =>
      HttpResponse.json({ ...usersFixture[0], active: false }),
    ),
    http.post(url('/admin/users/:id/activate', base), () =>
      HttpResponse.json({ ...usersFixture[0], active: true }),
    ),

    http.get(url('/super/property-types', base), () => HttpResponse.json(propertyTypesFixture)),

    // ── Property tree ───────────────────────────────────────────────────────────────────────
    http.get(url('/admin/property/profile', base), () => HttpResponse.json(propertyProfileFixture)),
    http.get(url('/admin/property/occupancy', base), () =>
      HttpResponse.json(occupancySummaryFixture),
    ),
    // depth/parentId are the two ways the console reads the tree: a whole level, or one node's
    // children. The fixture tree is two levels, so both resolve to blocks or flats.
    http.get(url('/admin/property/nodes', base), ({ request }) => {
      const params = new URL(request.url).searchParams;
      const depth = params.get('depth');
      const parentId = params.get('parentId');
      if (depth === '0') return HttpResponse.json(blocksFixture);
      if (depth === '1') return HttpResponse.json(flatsFixture);
      if (parentId) return HttpResponse.json(flatsFixture.filter((f) => f.parentId === parentId));
      return HttpResponse.json([...blocksFixture, ...flatsFixture]);
    }),
    http.post(url('/admin/property/nodes', base), async ({ request }) => {
      const body = (await request.json()) as { parentId?: string | null; name: string; code?: string };
      return HttpResponse.json(
        {
          id: IDS.blockA,
          parentId: body.parentId ?? null,
          depth: body.parentId ? 1 : 0,
          kind: body.parentId ? 'UNIT' : 'BUILDING',
          name: body.name,
          code: body.parentId ? (body.code ?? body.name) : null,
          levelNumber: null,
          declaredOccupancy: 0,
          residentAccounts: 0,
          childCount: 0,
          createdAt: '2026-07-23T14:30:00+05:30',
        },
        { status: 201 },
      );
    }),
    http.delete(
      url('/admin/property/nodes/:id', base),
      () => new HttpResponse(null, { status: 204 }),
    ),
    http.put(url('/admin/property/nodes/:id/occupancy', base), async ({ request }) => {
      const body = (await request.json()) as { declaredOccupancy: number };
      return HttpResponse.json({ ...flatsFixture[0], declaredOccupancy: body.declaredOccupancy });
    }),
    http.post(url('/admin/property/nodes/bulk', base), () =>
      HttpResponse.json({ floorsCreated: 0, unitsCreated: 2, codes: ['A-201', 'A-202'] }, { status: 201 }),
    ),
    http.patch(url('/admin/property/levels/:id', base), () =>
      HttpResponse.json(propertyProfileFixture),
    ),

    // ── Gates ───────────────────────────────────────────────────────────────────────────────
    http.get(url('/admin/gates', base), () => HttpResponse.json(gatesFixture)),
    http.post(url('/admin/gates', base), async ({ request }) => {
      const body = (await request.json()) as { name: string };
      return HttpResponse.json(
        { id: IDS.gateMain, name: body.name, createdAt: '2026-07-23T14:30:00+05:30' },
        { status: 201 },
      );
    }),
    http.delete(url('/admin/gates/:id', base), () => new HttpResponse(null, { status: 204 })),

    // ── Notifications ───────────────────────────────────────────────────────────────────────
    http.post(url('/notifications/preview', base), async ({ request }) => {
      const rule = (await request.json()) as { mode: string; flatIds?: string[]; blockIds?: string[] };
      const recipientCount =
        rule.mode === 'ALL' ? 312 : (rule.flatIds?.length ?? rule.blockIds?.length ?? 1) * 3;
      return HttpResponse.json({ recipientCount, deviceCount: Math.round(recipientCount * 1.5) });
    }),
    http.post(url('/notifications', base), () =>
      HttpResponse.json({ ...notificationFixture, status: 'QUEUED' }, { status: 201 }),
    ),
    http.get(url('/notifications', base), () =>
      HttpResponse.json(page([notificationFixture], { size: 25 })),
    ),
    http.get(url('/notifications/mine', base), () => HttpResponse.json(page([], { size: 25 }))),
    http.get(url('/notifications/mine/unread-count', base), () => HttpResponse.json({ unread: 0 })),
    http.patch(url('/notifications/mine/:id/read', base), ({ params }) =>
      HttpResponse.json({
        id: params.id,
        notificationId: IDS.notification,
        title: notificationFixture.title,
        body: notificationFixture.body,
        read: true,
        readAt: '2026-07-23T14:35:00+05:30',
        sentAt: notificationFixture.sentAt,
      }),
    ),

    // ── Community ───────────────────────────────────────────────────────────────────────────
    http.get(url('/community/posts', base), () => HttpResponse.json(page([postFixture], { size: 20 }))),
    http.post(url('/community/posts', base), async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      return HttpResponse.json({ ...postFixture, ...body }, { status: 201 });
    }),
    http.delete(url('/community/posts/:id', base), () => new HttpResponse(null, { status: 204 })),

    // ── Passes / sales / devices ────────────────────────────────────────────────────────────
    http.get(url('/passes/mine', base), () => HttpResponse.json(page([], { size: 25 }))),
    http.post(url('/passes', base), () =>
      HttpResponse.json(
        {
          id: IDS.pass,
          pin: '481920',
          qrToken: IDS.pass,
          validFrom: '2026-07-23T14:30:00+05:30',
          validUntil: '2026-07-23T18:00:00+05:30',
          maxUses: 1,
        },
        { status: 201 },
      ),
    ),
    http.post(url('/passes/redeem', base), () =>
      HttpResponse.json({
        passId: IDS.pass,
        visit: { ...insideVisitFixture, preApprovalId: IDS.pass },
        remainingUses: 0,
      }),
    ),
    http.delete(url('/passes/:id', base), () => new HttpResponse(null, { status: 204 })),

    http.get(url('/sales/on-duty', base), () =>
      HttpResponse.json([{ id: IDS.sales, fullName: 'Meera Shah', loginId: 'sales-01' }]),
    ),
    http.patch(url('/sales/me/duty', base), () => HttpResponse.json(usersFixture[0])),

    http.get(url('/devices', base), () => HttpResponse.json([])),
    http.post(url('/devices', base), () =>
      HttpResponse.json({
        id: IDS.guard,
        platform: 'WEB',
        lastSeenAt: '2026-07-23T14:30:00+05:30',
        createdAt: '2026-07-23T14:30:00+05:30',
      }),
    ),
    http.delete(url('/devices/:id', base), () => new HttpResponse(null, { status: 204 })),

    // ── Platform (SUPER_ADMIN) ──────────────────────────────────────────────────────────────
    http.get(url('/super/townships', base), ({ request }) => {
      const includeArchived = new URL(request.url).searchParams.get('includeArchived') === 'true';
      const rows = includeArchived
        ? [townshipFixture, archivedTownshipFixture]
        : [townshipFixture];
      return HttpResponse.json(page(rows));
    }),
    http.get(url('/super/townships/:id', base), () => HttpResponse.json(townshipFixture)),
    http.post(url('/super/townships', base), async ({ request }) => {
      const body = (await request.json()) as {
        code: string;
        name: string;
        admin: { loginId: string; fullName: string };
      };
      return HttpResponse.json(
        {
          township: { ...townshipFixture, code: body.code.toUpperCase(), name: body.name },
          admin: {
            id: IDS.admin,
            loginId: body.admin.loginId,
            fullName: body.admin.fullName,
            role: 'ADMIN',
            townshipId: IDS.township,
            generatedPassword: 'Xk7-Rq2m-Zt9v',
          },
        },
        { status: 201 },
      );
    }),
    http.post(url('/super/townships/:id/suspend', base), () =>
      HttpResponse.json({ ...townshipFixture, status: 'SUSPENDED' }),
    ),
    http.post(url('/super/townships/:id/restore', base), () =>
      HttpResponse.json({ ...townshipFixture, status: 'ACTIVE' }),
    ),
    http.delete(url('/super/townships/:id', base), async ({ request }) => {
      const body = (await request.json()) as { confirmCode: string };
      // Mirrors the server: the code has to come back, or nothing is archived.
      if (body.confirmCode.toUpperCase() !== townshipFixture.code) {
        return HttpResponse.json(
          apiError(422, 'CONFIRMATION_MISMATCH', "confirmCode must match the township's code."),
          { status: 422 },
        );
      }
      return HttpResponse.json({
        ...townshipFixture,
        status: 'ARCHIVED',
        archivedAt: '2026-08-26T10:00:00+05:30',
      });
    }),
    http.get(url('/super/townships/:id/admins', base), () =>
      HttpResponse.json([{ ...usersFixture[0], loginId: 'greenwood-admin', role: 'ADMIN' }]),
    ),
    http.post(url('/super/townships/:id/admins', base), async ({ request }) => {
      const body = (await request.json()) as { loginId: string; fullName: string };
      return HttpResponse.json(
        {
          id: IDS.admin,
          loginId: body.loginId,
          fullName: body.fullName,
          role: 'ADMIN',
          townshipId: IDS.township,
          generatedPassword: 'Bn4-Wp8k-Lm3q',
        },
        { status: 201 },
      );
    }),
    http.delete(url('/super/townships/:id/admins/:userId', base), () =>
      HttpResponse.json({ ...usersFixture[0], role: 'ADMIN', active: false }),
    ),
    http.get(url('/super/admins', base), () => HttpResponse.json([])),
  ];
}

export const handlers = createHandlers();

/**
 * One-line overrides for the error paths §12 requires every screen to be tested against.
 *
 * `server.use(errorOnce.conflict('/visits/:id/decision'))` reads at the call site as the thing
 * being tested, which is the point.
 */
export const errorOnce = {
  conflict: (path: string, message = 'This visit was already decided.', base = DEFAULT_API_URL) =>
    http.patch(url(path, base), () => HttpResponse.json(apiError(409, 'CONFLICT', message), { status: 409 }), {
      once: true,
    }),

  forbidden: (path: string, base = DEFAULT_API_URL) =>
    http.get(url(path, base), () => HttpResponse.json(apiError(403, 'FORBIDDEN', 'Not permitted.'), { status: 403 }), {
      once: true,
    }),

  passwordResetRequired: (path: string, base = DEFAULT_API_URL) =>
    http.get(
      url(path, base),
      () =>
        HttpResponse.json(
          apiError(403, 'PASSWORD_RESET_REQUIRED', 'Password reset is required.'),
          { status: 403 },
        ),
      { once: true },
    ),

  validation: (
    path: string,
    fieldErrors: { field: string; message: string }[],
    base = DEFAULT_API_URL,
  ) =>
    http.post(
      url(path, base),
      () =>
        HttpResponse.json(
          apiError(400, 'VALIDATION_FAILED', 'Validation failed.', { fieldErrors }),
          { status: 400 },
        ),
      { once: true },
    ),

  serverError: (path: string, base = DEFAULT_API_URL) =>
    http.get(
      url(path, base),
      () =>
        HttpResponse.json(apiError(500, 'INTERNAL_ERROR', 'Unexpected error.'), { status: 500 }),
      { once: true },
    ),

  unauthorizedOnce: (path: string, base = DEFAULT_API_URL) =>
    http.get(
      url(path, base),
      () => HttpResponse.json(apiError(401, 'UNAUTHORIZED', 'Token expired.'), { status: 401 }),
      { once: true },
    ),
};

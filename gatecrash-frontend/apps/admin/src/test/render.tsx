import {
  ApiProvider,
  SessionManager,
  createApiClient,
  createQueryClient,
  type MeResponse,
  type TokenStore,
} from '@gatecrash/api';
import { type QueryClient } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { Toaster } from '@/components/toaster';
import '@/lib/i18n';
import { useSessionStore } from '@/lib/session';
import { TEST_API_URL } from './server';

/**
 * Render helper.
 *
 * Note what is deliberately *not* provided: a `RealtimeProvider`. Every screen must render
 * correctly from REST alone (guardrail #7), so the default test environment has **no socket at
 * all** — which makes the §12.1 "socket-dead reconciliation" property the default condition
 * rather than a special case someone has to remember to set up.
 */

function memoryTokenStore(): TokenStore {
  let access: string | null = 'test-access-token';
  let refresh: string | null = 'test-refresh-token';
  return {
    getAccessToken: () => access,
    getRefreshToken: async () => refresh,
    setTokens: async (t) => {
      access = t.accessToken;
      refresh = t.refreshToken;
    },
    clear: async () => {
      access = null;
      refresh = null;
    },
  };
}

export interface RenderOptions {
  route?: string;
  /** Seeds the session store, so a screen renders as if boot had already resolved. */
  session?: Partial<MeResponse> | null;
  mustResetPassword?: boolean;
}

/**
 * Derived from `render`'s own return type rather than from `RenderResult`: the exported alias
 * loses its bound queries across the @testing-library/react ↔ /dom version boundary, which would
 * make `result.getByText` a type error in every test.
 */
export type RenderContext = ReturnType<typeof render> & { queryClient: QueryClient };

export const TEST_TOWNSHIP_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

export const ADMIN_SESSION: MeResponse = {
  id: '11111111-1111-4111-8111-111111111111',
  loginId: 'admin',
  fullName: 'Priya Nair',
  role: 'ADMIN',
  mustResetPassword: false,
  onDuty: false,
  flatId: null,
  flatNumber: null,
  blockName: null,
  townshipId: TEST_TOWNSHIP_ID,
  townshipCode: 'GREENWOOD',
  townshipName: 'Greenwood Township',
} as MeResponse;

/**
 * A platform operator: no township at all.
 *
 * `setMe` seeds `actingTownshipId` from the session, so this session starts with **none** — which
 * is the state the router has to handle, and the one a test asking "what does a super admin see
 * before choosing a township?" needs.
 */
export const SUPER_ADMIN_SESSION: MeResponse = {
  ...ADMIN_SESSION,
  id: '22222222-2222-4222-8222-222222222222',
  loginId: 'superadmin',
  fullName: 'Platform Operator',
  role: 'SUPER_ADMIN',
  townshipId: null,
  townshipCode: null,
  townshipName: null,
} as MeResponse;

export function renderWithProviders(
  ui: ReactElement,
  { route = '/', session = ADMIN_SESSION, mustResetPassword = false }: RenderOptions = {},
): RenderContext {
  const queryClient = createQueryClient();
  // Retries would make a test asserting an error state wait for three attempts first.
  queryClient.setDefaultOptions({ queries: { retry: false, gcTime: 0 } });

  const sessionManager = new SessionManager({
    baseUrl: TEST_API_URL,
    store: memoryTokenStore(),
  });
  const client = createApiClient({ baseUrl: TEST_API_URL, session: sessionManager });

  if (session) {
    useSessionStore.getState().setMe({ ...ADMIN_SESSION, ...session, mustResetPassword });
  } else {
    useSessionStore.getState().setUnauthenticated();
  }

  const Wrapper = ({ children }: { children: ReactNode }) => (
    <ApiProvider client={client} queryClient={queryClient}>
      <MemoryRouter
        initialEntries={[route]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        {children}
      </MemoryRouter>
      <Toaster />
    </ApiProvider>
  );

  // `Object.assign` rather than a spread: spreading loses the query methods' binding in the type
  // system when @testing-library/react and /dom resolve separate copies of the types.
  return Object.assign(render(ui, { wrapper: Wrapper }), { queryClient });
}

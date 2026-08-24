import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { ApiClient } from '../client';
import { createEndpoints, type Endpoints } from '../endpoints';
import { ApiException } from '../errors';
import { SessionExpired } from '../session';

/**
 * Wiring — one `ApiClient`, one `Endpoints`, one `QueryClient` per app.
 *
 * The retry policy here is the interesting part. TanStack's default (3 retries on everything) is
 * wrong for this API: retrying a `403` cannot succeed, retrying a `409` re-races a decision
 * someone already won, and retrying a `429` is precisely what the server's rate limiter is
 * asking us not to do. So retries are limited to the failures that are actually transient.
 */

interface ApiContextValue {
  client: ApiClient;
  endpoints: Endpoints;
}

const ApiContext = createContext<ApiContextValue | null>(null);

export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof SessionExpired) return false;
  if (error instanceof ApiException) {
    // Anything the server answered deliberately is not worth repeating. A 401 has already been
    // refresh-and-retried once inside the client (§5.3); a second attempt is a logout, not a retry.
    if (error.status >= 400 && error.status < 500) return false;
    if (error.code === 'CONTRACT_VIOLATION') return false;
  }
  return failureCount < 2;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetry,
        // Live surfaces reconcile on connect and on focus (§6.5, guardrail #7). Refetch-on-focus
        // is half of that guarantee and is deliberately left on.
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        staleTime: 30_000,
        gcTime: 5 * 60_000,
      },
      mutations: {
        // A mutation is a write. Replaying one on a network hiccup could double-log a visit.
        retry: false,
      },
    },
  });
}

export interface ApiProviderProps {
  client: ApiClient;
  queryClient: QueryClient;
  children: ReactNode;
}

export function ApiProvider({ client, queryClient, children }: ApiProviderProps) {
  const value = useMemo<ApiContextValue>(
    () => ({ client, endpoints: createEndpoints(client) }),
    [client],
  );

  return (
    <ApiContext.Provider value={value}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ApiContext.Provider>
  );
}

export function useApi(): ApiContextValue {
  const value = useContext(ApiContext);
  if (!value) throw new Error('useApi must be used inside <ApiProvider>');
  return value;
}

export function useEndpoints(): Endpoints {
  return useApi().endpoints;
}

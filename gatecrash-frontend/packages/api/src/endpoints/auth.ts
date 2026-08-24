import type { ApiClient } from '../client';
import {
  loginResponseSchema,
  meResponseSchema,
  parseResponse,
  type ChangePasswordRequest,
  type LoginRequest,
  type LoginResponse,
  type MeResponse,
} from '../schemas';

/**
 * Auth endpoints — FRONTEND.md §5.
 *
 * `login` and `refresh` are the only anonymous calls in the app; everything else carries a bearer.
 * `refresh` itself is not here — it lives on `SessionManager` (§5.3), because it must be
 * serialised through the single-flight guard and calling it from anywhere else would defeat that.
 */
export function authEndpoints(client: ApiClient) {
  return {
    async login(body: LoginRequest): Promise<LoginResponse> {
      const raw = await client.post<unknown>('auth/login', { json: body, anonymous: true });
      const parsed = parseResponse(loginResponseSchema, raw, 'login response');
      await client.session.adopt(parsed);
      return parsed as LoginResponse;
    },

    /**
     * Changing a password revokes every refresh token and returns a **fresh `LoginResponse`**.
     * Adopting it is not optional: skipping this signs the user out the instant they succeed,
     * which reads as a broken app (§5.3).
     */
    async changePassword(body: ChangePasswordRequest): Promise<LoginResponse> {
      const raw = await client.post<unknown>('auth/password', { json: body });
      const parsed = parseResponse(loginResponseSchema, raw, 'password change response');
      await client.session.adopt(parsed);
      return parsed as LoginResponse;
    },

    async me(signal?: AbortSignal): Promise<MeResponse> {
      const raw = await client.get<unknown>('auth/me', signal ? { signal } : {});
      return parseResponse(meResponseSchema, raw, 'session') as MeResponse;
    },

    /**
     * Revoke the supplied refresh token server-side. The caller is responsible for the rest of
     * the §5.5 ordering — de-register the device *first*, then this, then clear the token store.
     */
    async logout(refreshToken: string | null): Promise<void> {
      await client.post<void>('auth/logout', { json: refreshToken ? { refreshToken } : {} });
    },
  };
}

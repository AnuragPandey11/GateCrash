import type { z } from 'zod';
import { ApiException, CONTRACT_VIOLATION_CODE } from '../errors';

/**
 * Parse a response at the boundary — FRONTEND.md §4.2.
 *
 * A schema failure is not a user error, it is *contract drift*: the backend renamed a field and
 * the OpenAPI drift check did not catch it. Turning it into a loud, correlation-id-bearing
 * `ApiException` rather than letting `undefined` flow into a guard's screen is the entire point
 * of parsing these four payloads at all.
 */
export function parseResponse<T extends z.ZodTypeAny>(
  schema: T,
  value: unknown,
  what: string,
): z.infer<T> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;

  const detail = result.error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');

  throw new ApiException({
    code: CONTRACT_VIOLATION_CODE,
    status: 0,
    message: `The server sent an unexpected ${what}. This build may be out of date. (${detail})`,
    cause: result.error,
  });
}

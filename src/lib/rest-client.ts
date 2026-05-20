/**
 * Minimal REST client for Twenty's Core and Metadata APIs.
 * Uses raw fetch so it works with dynamically created custom fields
 * that the typed SDK client doesn't know about at build time.
 */

const apiUrl = () => process.env['TWENTY_API_URL'] ?? '';
const token = () => process.env['TWENTY_APP_ACCESS_TOKEN'] ?? '';

async function request<T>(
  base: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token()}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  }
  return JSON.parse(text) as T;
}

export const coreApi = {
  get: <T>(path: string) => request<T>(`${apiUrl()}/rest`, 'GET', path),
  post: <T>(path: string, body: unknown) => request<T>(`${apiUrl()}/rest`, 'POST', path, body),
  patch: <T>(path: string, body: unknown) => request<T>(`${apiUrl()}/rest`, 'PATCH', path, body),
};

export const metaApi = {
  get: <T>(path: string) => request<T>(`${apiUrl()}/rest/metadata`, 'GET', path),
  post: <T>(path: string, body: unknown) => request<T>(`${apiUrl()}/rest/metadata`, 'POST', path, body),
};

/** Run a raw GraphQL query against the /graphql endpoint. */
export async function gql<T = unknown>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  return request<T>(`${apiUrl()}`, 'POST', '/graphql', { query, variables });
}

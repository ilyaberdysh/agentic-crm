// Return-to handling for logged-out deep links (sessions): `origin` is a same-origin path + query.

/** The current location as an `origin` value (path + search, no hash). */
export function currentOrigin(): string {
  if (typeof window === 'undefined') return '/';
  return `${window.location.pathname}${window.location.search}`;
}

/** Only same-origin absolute paths are honoured ("/companies?x=1"), never "//evil.com" or "https://…". */
export function safeOrigin(origin: unknown): string | null {
  if (typeof origin !== 'string' || origin.length === 0) return null;
  if (!origin.startsWith('/') || origin.startsWith('//') || origin.startsWith('/\\')) return null;
  if (origin.startsWith('/auth/sign-in') || origin.startsWith('/api/')) return null;
  return origin;
}

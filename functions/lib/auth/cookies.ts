/** Reading and writing the cookies sign-in uses. */

export const SESSION_COOKIE = 'cm_session';
export const OAUTH_COOKIE = 'cm_oauth';
/** A sign-up waiting on its age check (see signup.ts). */
export const SIGNUP_COOKIE = 'cm_signup';

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie') ?? '';
  for (const part of header.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) {
      return decodeURIComponent(value.join('='));
    }
  }
  return null;
}

/**
 * A Set-Cookie value for this site only: HttpOnly, and Lax so the provider's
 * redirect back to us still carries it while another site's POST does not.
 * Secure except over plain http, which only a local dev server uses.
 */
export function cookie(request: Request, name: string, value: string, maxAgeSeconds: number): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

export function clearCookie(request: Request, name: string): string {
  return cookie(request, name, '', 0);
}

const BASE = 'https://ciphermaniac.invalid';

/**
 * A path on this site to return to after sign-in; anything else becomes the
 * home page. Resolved as a browser would, since browsers drop tabs and line
 * breaks inside a URL: `/\t/evil.example` reads as a path but lands off-site.
 */
export function safeNext(next: string | null): string {
  if (!next?.startsWith('/')) {
    return '/';
  }
  const url = new URL(next, BASE);
  return url.origin === BASE ? `${url.pathname}${url.search}${url.hash}` : '/';
}

/** A 302 that also sets (or clears) cookies. */
export function redirectWithCookies(location: string, cookies: readonly string[]): Response {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store' });
  for (const value of cookies) {
    headers.append('Set-Cookie', value);
  }
  return new Response(null, { status: 302, headers });
}

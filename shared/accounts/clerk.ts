/**
 * Where a Clerk instance lives. A publishable key is `pk_test_` or `pk_live_`,
 * then the instance's Frontend API host and a `$` in base64. The server checks
 * session tokens against it as their issuer, and the sign-in page loads
 * Clerk's script from it.
 */

/** The shortest password the Clerk instance accepts, as it is set (`auth_password.min_length`). */
export const PASSWORD_MIN = 15;

/** The Frontend API origin a publishable key names, or null when it names none. */
export function frontendApi(publishableKey: string): string | null {
  const encoded = /^pk_(?:test|live)_(?<host>[A-Za-z0-9+/=]+)$/u.exec(publishableKey)?.groups?.host;
  try {
    const host = encoded ? atob(encoded) : '';
    return /^[a-z0-9.-]+\$$/u.test(host) ? `https://${host.slice(0, -1)}` : null;
  } catch {
    return null;
  }
}

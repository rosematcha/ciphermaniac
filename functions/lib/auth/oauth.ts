/**
 * Google and Discord sign-in, as OAuth 2.0 authorization-code flows. A
 * username and password sign-in through Clerk (clerk.ts) ends in the same
 * kind of profile but has no redirect of its own.
 *
 * Both are confidential clients: the code is exchanged server-side with the
 * client secret, and the random `state` round-trips through an HttpOnly cookie
 * so a callback this browser did not start is refused. Each provider is a
 * table of URLs and one function that turns its profile into ours.
 *
 * `dev` signs in as a named test user with no provider at all. It exists so the
 * organizer and player flows can be exercised locally without OAuth apps, and
 * it only answers when DEV_LOGIN is "true" and ENVIRONMENT is not production.
 */

export type ProviderId = 'google' | 'discord' | 'dev' | 'clerk';
/** The providers /api/auth/login and /api/auth/callback answer for. */
type RedirectProvider = Exclude<ProviderId, 'clerk'>;
type OAuthProvider = Exclude<RedirectProvider, 'dev'>;

export interface AuthEnv {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  DISCORD_CLIENT_ID?: string;
  DISCORD_CLIENT_SECRET?: string;
  /** Clerk's instance keys; username and password sign-in needs all three. */
  CLERK_PUBLISHABLE_KEY?: string;
  CLERK_SECRET_KEY?: string;
  /** The PEM public key Clerk signs session tokens with. */
  CLERK_JWT_KEY?: string;
  DEV_LOGIN?: string;
  ENVIRONMENT?: string;
}

export interface Profile {
  provider: ProviderId;
  subject: string;
  name: string;
  email: string | null;
  /** Only a verified email may link two providers to one account. */
  emailVerified: boolean;
  avatar: string | null;
}

interface Provider {
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
  credentials: (env: AuthEnv) => { id: string; secret: string } | null;
  profile: (accessToken: string, fetcher: typeof fetch) => Promise<Profile>;
}

type Json = Record<string, unknown>;

const text = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

async function getJson(url: string, accessToken: string, fetcher: typeof fetch): Promise<Json> {
  const response = await fetcher(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) {
    throw new Error(`Profile request failed: ${response.status}`);
  }
  return (await response.json()) as Json;
}

/** Discord's display name, then its username; its avatar when one is set. */
export function discordProfile(user: Json): Profile {
  const id = text(user.id) ?? '';
  const avatar = text(user.avatar);
  return {
    provider: 'discord',
    subject: id,
    name: text(user.global_name) ?? text(user.username) ?? 'Discord user',
    email: text(user.email),
    emailVerified: user.verified === true,
    avatar: avatar ? `https://cdn.discordapp.com/avatars/${id}/${avatar}.png?size=64` : null
  };
}

export function googleProfile(user: Json): Profile {
  return {
    provider: 'google',
    subject: text(user.sub) ?? '',
    name: text(user.name) ?? text(user.email) ?? 'Google user',
    email: text(user.email),
    emailVerified: user.email_verified === true,
    avatar: text(user.picture)
  };
}

function pair(id: string | undefined, secret: string | undefined) {
  return id && secret ? { id, secret } : null;
}

const PROVIDERS: Record<OAuthProvider, Provider> = {
  google: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
    credentials: env => pair(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET),
    profile: async (token, fetcher) =>
      googleProfile(await getJson('https://openidconnect.googleapis.com/v1/userinfo', token, fetcher))
  },
  discord: {
    authorizeUrl: 'https://discord.com/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    scope: 'identify email',
    credentials: env => pair(env.DISCORD_CLIENT_ID, env.DISCORD_CLIENT_SECRET),
    profile: async (token, fetcher) =>
      discordProfile(await getJson('https://discord.com/api/users/@me', token, fetcher))
  }
};

export function isRedirectProvider(value: string | undefined): value is RedirectProvider {
  return value === 'google' || value === 'discord' || value === 'dev';
}

export function devLoginEnabled(env: AuthEnv): boolean {
  return env.DEV_LOGIN === 'true' && env.ENVIRONMENT !== 'production';
}

/** Google and Discord, as far as each has its credentials. */
export function configuredOAuth(env: AuthEnv): OAuthProvider[] {
  return (['google', 'discord'] as const).filter(id => PROVIDERS[id].credentials(env) !== null);
}

export function redirectUri(request: Request, provider: OAuthProvider): string {
  return `${new URL(request.url).origin}/api/auth/callback/${provider}`;
}

/** Where to send the browser to sign in, or null when the provider is not configured. */
export function authorizeUrl(env: AuthEnv, request: Request, provider: OAuthProvider, state: string): string | null {
  const config = PROVIDERS[provider];
  const credentials = config.credentials(env);
  if (!credentials) {
    return null;
  }
  const url = new URL(config.authorizeUrl);
  url.search = new URLSearchParams([
    ['client_id', credentials.id],
    ['redirect_uri', redirectUri(request, provider)],
    ['response_type', 'code'],
    ['scope', config.scope],
    ['state', state],
    ['prompt', provider === 'google' ? 'select_account' : 'none']
  ]).toString();
  return url.toString();
}

export interface CodeExchange {
  env: AuthEnv;
  request: Request;
  provider: OAuthProvider;
  code: string;
}

/** Trades the callback's code for the signed-in user's profile. */
export async function exchangeCode(exchange: CodeExchange, fetcher: typeof fetch = fetch): Promise<Profile> {
  const config = PROVIDERS[exchange.provider];
  const credentials = config.credentials(exchange.env);
  if (!credentials) {
    throw new Error(`${exchange.provider} sign-in is not configured`);
  }
  const response = await fetcher(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams([
      ['client_id', credentials.id],
      ['client_secret', credentials.secret],
      ['grant_type', 'authorization_code'],
      ['code', exchange.code],
      ['redirect_uri', redirectUri(exchange.request, exchange.provider)]
    ])
  });
  if (!response.ok) {
    throw new Error(`Token exchange failed: ${response.status}`);
  }
  const token = text(((await response.json()) as Json).access_token);
  if (!token) {
    throw new Error('Token exchange returned no access token');
  }
  const profile = await config.profile(token, fetcher);
  if (!profile.subject) {
    throw new Error('Profile has no account ID');
  }
  return profile;
}

/** The profile a dev sign-in stands for: one user per name typed. */
export function devProfile(name: string): Profile {
  const clean = name.trim().slice(0, 40) || 'Test Organizer';
  return {
    provider: 'dev',
    subject: clean.toLowerCase(),
    name: clean,
    email: null,
    emailVerified: false,
    avatar: null
  };
}

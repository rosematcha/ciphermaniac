import { runOnlineMetaJob } from '../lib/onlineMeta.js';

interface CronEnv {
  CRON_SECRET?: string;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json'
    }
  });
}

/**
 * Verify cron authentication for HTTP requests.
 * Returns null if authenticated, or an error Response if not.
 */
function verifyCronAuth(request: Request, env: CronEnv): Response | null {
  const cronSecret = env.CRON_SECRET;

  // If no secret is configured, deny access (fail secure)
  if (!cronSecret) {
    console.error('CRON_SECRET environment variable not configured');
    return jsonResponse({ error: 'Unauthorized: Cron secret not configured' }, 401);
  }

  const providedSecret = request.headers.get('X-Cron-Secret');

  if (!providedSecret || providedSecret !== cronSecret) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  return null; // Authenticated
}

export async function onRequestGet({ request, env }: { request: Request; env: CronEnv }): Promise<Response> {
  // Verify cron authentication for HTTP requests
  const authError = verifyCronAuth(request, env);
  if (authError) {
    return authError;
  }

  const result = await runOnlineMetaJob(env);
  return jsonResponse(result, (result as { success?: boolean })?.success ? 200 : 500);
}

// Cloudflare scheduled event handler - no auth needed, only called by CF cron
export async function onCron({ env }: { env: CronEnv }): Promise<void> {
  await runOnlineMetaJob(env);
}

// Cloudflare Workers scheduled event handler - no auth needed, only called by CF cron
export async function scheduled(_controller: unknown, env: CronEnv, _ctx: unknown): Promise<void> {
  await runOnlineMetaJob(env);
}

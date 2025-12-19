import { runOnlineMetaJob } from '../lib/onlineMeta.js';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json'
    }
  });
}

export async function onRequestGet({ env }: { env: unknown }): Promise<Response> {
  const result = await runOnlineMetaJob(env);
  return jsonResponse(result, (result as { success?: boolean })?.success ? 200 : 500);
}

export async function onCron({ env }: { env: unknown }): Promise<void> {
  await runOnlineMetaJob(env);
}

export async function scheduled(controller: unknown, env: unknown, _ctx: unknown): Promise<void> {
  await runOnlineMetaJob(env);
}

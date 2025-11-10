import { runOnlineMetaJob } from '../lib/onlineMeta.js';

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json'
    }
  });
}

export async function onRequestGet({ env }) {
  const result = await runOnlineMetaJob(env);
  return jsonResponse(result, result.success ? 200 : 500);
}

export async function onCron({ env }) {
  await runOnlineMetaJob(env);
}

export async function scheduled(controller, env, ctx) {
  await runOnlineMetaJob(env);
}

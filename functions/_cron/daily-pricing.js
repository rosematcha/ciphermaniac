/**
 * Daily pricing update endpoint
 * Triggered by external cron service at 3:30 PM CST (8:30 PM UTC)
 * 
 * This endpoint is called by an external cron service once daily
 * to update pricing data from TCGCSV
 */

import { runDailyPricingJob } from '../lib/runDailyPricingJob.js';

export async function onRequestGet({ env }) {
  return runDailyPricingJob(env);
}

// Cloudflare Pages Cron triggers invoke the onCron handler.
export async function onCron({ env }) {
  await runDailyPricingJob(env);
}

// Also support Worker-style scheduled handler (module/ESM syntax)
// Cloudflare's docs show a `scheduled(controller, env, ctx)` signature.
export async function scheduled(controller, env, ctx) {
  // controller may contain scheduledTime and other metadata
  await runDailyPricingJob(env);
}
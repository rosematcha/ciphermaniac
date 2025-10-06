/**
 * HTTP-accessible endpoint to trigger the daily pricing job.
 * Intended for external schedulers or manual invocations.
 */

import { runDailyPricingJob } from '../lib/runDailyPricingJob.js';

export async function onRequestGet({ env }) {
  return runDailyPricingJob(env);
}

export async function onRequestPost({ env }) {
  return runDailyPricingJob(env);
}

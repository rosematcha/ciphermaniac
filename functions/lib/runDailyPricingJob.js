/**
 * Shared helper to execute the daily pricing update and wrap the response
 * so it can be invoked from both cron triggers and HTTP endpoints.
 */

import { onRequestGet as pricingUpdate } from '../api/pricing.js';

export async function runDailyPricingJob(env) {
  console.log('Daily pricing job triggered at:', new Date().toISOString());

  try {
    // Execute the main pricing update function and parse its JSON payload
    const response = await pricingUpdate({ env });
    const result = await response.json();

    console.log('Pricing update completed successfully:', result);

    return new Response(JSON.stringify({
      success: true,
      message: 'Daily pricing update completed',
      result,
      timestamp: new Date().toISOString()
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Daily pricing update failed:', error);

    return new Response(JSON.stringify({
      success: false,
      error: 'Pricing update failed',
      message: error.message,
      timestamp: new Date().toISOString()
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Manual webhook to trigger pricing update
 * Returns detailed JSON output for testing
 */

export async function onRequestPost({ request, env }) {
  try {
    console.log('Manual pricing trigger initiated at:', new Date().toISOString());
    
    // Import the pricing function
    const { onRequestGet } = await import('./pricing.js');
    
    // Execute the pricing update
    const response = await onRequestGet({ env });
    const result = await response.json();
    
    // Return detailed result with timing
    return new Response(JSON.stringify({
      webhook: {
        triggered: true,
        timestamp: new Date().toISOString(),
        method: 'manual_webhook'
      },
      result: result,
      success: !result.error
    }, null, 2), {
      status: response.ok ? 200 : 500,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (error) {
    console.error('Manual trigger error:', error);
    
    return new Response(JSON.stringify({
      webhook: {
        triggered: true,
        timestamp: new Date().toISOString(),
        method: 'manual_webhook'
      },
      result: {
        error: 'Manual trigger failed',
        message: error.message,
        stack: error.stack
      },
      success: false
    }, null, 2), {
      status: 500,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}

export async function onRequestGet({ env }) {
  // Allow GET requests too for easy browser testing
  return new Response(JSON.stringify({
    message: 'Manual Pricing Trigger Webhook',
    usage: 'Send POST request to trigger pricing update',
    example: 'curl -X POST https://your-site.pages.dev/api/trigger-pricing',
    testEndpoint: '/api/test-pricing for component testing'
  }, null, 2), {
    status: 200,
    headers: { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

// Handle preflight requests
export async function onRequestOptions() {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
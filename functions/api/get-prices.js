/**
 * CloudFlare Pages function to serve current pricing data
 * Simple read-only endpoint for client applications
 */

export async function onRequestGet({ env }) {
  try {
    // Get price data from KV storage
    if (!env.PRICE_DATA) {
      return new Response(JSON.stringify({ 
        error: 'Price data not available',
        message: 'KV storage not configured' 
      }), {
        status: 503,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
    
    const priceDataJson = await env.PRICE_DATA.get('current_prices');
    
    if (!priceDataJson) {
      return new Response(JSON.stringify({ 
        error: 'No price data available',
        message: 'Price data has not been generated yet. Check back after 3:30 PM CST.' 
      }), {
        status: 404,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
    
    const priceData = JSON.parse(priceDataJson);
    
    return new Response(JSON.stringify(priceData), {
      status: 200,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600' // Cache for 1 hour
      }
    });

  } catch (error) {
    console.error('Error serving price data:', error);
    
    return new Response(JSON.stringify({ 
      error: 'Internal server error',
      message: error.message 
    }), {
      status: 500,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}

// Handle preflight requests
export async function onRequestOptions() {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
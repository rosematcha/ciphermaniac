/**
 * Daily pricing update endpoint
 * Triggered by external cron service at 3:30 PM CST (8:30 PM UTC)
 * 
 * This endpoint is called by an external cron service once daily
 * to update pricing data from TCGCSV
 */

export async function onRequestGet({ env }) {
  console.log('Daily pricing cron job triggered at:', new Date().toISOString());
  
  try {
    // Import the pricing function
    const { onRequestGet: pricingUpdate } = await import('../api/pricing.js');
    
    // Call the pricing update function
    const response = await pricingUpdate({ env });
    const result = await response.json();
    
    console.log('Pricing update completed:', result);
    
    return new Response(JSON.stringify({
      success: true,
      message: 'Daily pricing update completed',
      result: result,
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
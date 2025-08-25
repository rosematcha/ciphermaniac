/**
 * CloudFlare Cron Trigger for daily pricing updates
 * Scheduled for 3:30 PM CST (8:30 PM UTC / 9:30 PM UTC during DST)
 */

export default {
  async fetch(request, env, ctx) {
    console.log('Daily pricing cron job triggered');
    
    // Import the pricing function
    const { onRequestGet } = await import('../api/pricing.js');
    
    // Call the pricing update function
    return await onRequestGet({ env });
  },
  
  async scheduled(controller, env, ctx) {
    console.log('Scheduled pricing update triggered at:', new Date().toISOString());
    
    try {
      // Import and execute pricing update
      const { onRequestGet } = await import('../api/pricing.js');
      const response = await onRequestGet({ env });
      
      const result = await response.json();
      console.log('Pricing update result:', result);
      
    } catch (error) {
      console.error('Scheduled pricing update failed:', error);
    }
  }
};
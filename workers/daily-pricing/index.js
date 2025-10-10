export default {
  async scheduled(controller, env, ctx) {
    try {
      const url = env.SITE_URL || 'https://ciphermaniac.com/api/daily-pricing';
      const res = await fetch(url);
      const text = await res.text();
      console.log('Invoked /api/daily-pricing:', res.status, text.slice(0, 200));
    } catch (err) {
      console.error('Scheduled worker failed:', err);
    }
  }
};

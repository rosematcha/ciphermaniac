/**
 * Switches for work that ships before it launches. Each is off in production
 * and on in development, so the work can be seen locally first; flipping the
 * constant to true launches it everywhere.
 */

/** events.ciphermaniac.com is live: the nav carries an Events link out to it. */
const EVENTS_SITE_LAUNCHED = false;

export const showEventsSite: boolean = EVENTS_SITE_LAUNCHED || Boolean(import.meta.env?.DEV);

export const EVENTS_SITE_URL = 'https://events.ciphermaniac.com';

import { logger } from '../utils/logger.js';

export function initMissingThumbsDev() {
    // no-op
}

export function trackMissing(cardName: string, useSm: boolean, overrides: any) {
    // no-op or simple log
    logger.debug(`Missing thumb: ${cardName} (${useSm ? 'sm' : 'lg'})`);
}

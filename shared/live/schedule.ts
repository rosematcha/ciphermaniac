/**
 * Events the live poller watches. Hand-listed while the feature is being
 * proven; the RK9 event list carries the same fields and will replace this.
 * @module shared/live/schedule
 */

import type { LiveEvent } from './types';

export const LIVE_EVENTS: LiveEvent[] = [
  {
    labsCode: '0072',
    name: 'Baltimore Regional Championships',
    rk9Id: 'BA001-nEN1xl5ZJLGtFk',
    pod: 2,
    firstDay: '2026-09-18',
    lastDay: '2026-09-20'
  }
];

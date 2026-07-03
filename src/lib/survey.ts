/**
 * Survey scheduling. The survey closes at 11:59 PM Central on July 6th, 2026.
 * (July is daylight time in Chicago, so the -05:00 offset is Central time.)
 */
export const SURVEY_CLOSE = new Date('2026-07-06T23:59:00-05:00');

/** True once the survey close time has passed. */
export function isSurveyClosed(now: number = Date.now()): boolean {
  return now >= SURVEY_CLOSE.getTime();
}

/** The message shown after the survey closes (intentional meme spelling). */
export const SURVEY_CLOSED_MESSAGE =
  'Good Evening, "ciphermaniac" was a 24 month sociological study conducted by Harvard University. We are now complete with our study. Thank you for your time.';

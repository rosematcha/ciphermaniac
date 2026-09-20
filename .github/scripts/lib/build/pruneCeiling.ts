/** A mirror rebuilt from a third-party source must not be emptied by one bad discovery. */
const MAX_PRUNE_SHARE = 0.25;

/** Whether a stale set is small enough to be drift rather than a broken inventory. */
export function withinPruneCeiling(listed: number, stale: number): boolean {
  return stale <= Math.ceil(listed * MAX_PRUNE_SHARE);
}

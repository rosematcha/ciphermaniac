/**
 * Environment access for the pipeline and tooling entrypoints.
 *
 * Thirteen scripts each defined their own `requireEnv`, functionally identical
 * and differing only in error wording, and fifteen independently read the same
 * four R2 variables. That is fine until one of them drifts — a different
 * variable name, a subtly different truthiness rule for a dry-run flag — and
 * then two jobs disagree about what they were told to do.
 *
 * Deliberately small: reading environment variables does not need a
 * configuration framework, it needs one implementation.
 *
 * SECRETS: {@link requireEnv} names the missing variable but never reports a
 * value, and {@link r2Config} returns credentials without logging them. A
 * pipeline failure is public in the Actions log.
 * @module .github/scripts/lib/env
 */

import process from 'node:process';

/**
 * Read a required environment variable.
 * @param name - Variable name
 * @returns Its trimmed value
 * @throws {Error} When it is unset or empty, naming the variable but never its value
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value.trim();
}

/**
 * Read an optional environment variable.
 * @param name - Variable name
 * @param fallback - Value to use when unset or empty
 * @returns The trimmed value, or the fallback
 */
export function optionalEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : fallback;
}

/**
 * Read a boolean flag.
 *
 * Only an explicit affirmative counts. GitHub Actions renders an unchecked
 * boolean input as the STRING `"false"`, which is truthy in JavaScript — so a
 * plain `Boolean(process.env.X)` reads an unchecked box as "yes". That is the
 * failure mode this exists to prevent, and it is one a destructive job cannot
 * afford.
 * @param name - Variable name
 * @param fallback - Value when unset or empty
 * @returns Whether the flag is affirmative
 */
export function boolEnv(name: string, fallback = false): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const value = raw.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(value)) {
    return true;
  }
  if (['false', '0', 'no', 'off'].includes(value)) {
    return false;
  }
  throw new Error(`Environment variable ${name} must be a boolean, got ${JSON.stringify(raw)}`);
}

/**
 * Read a bounded integer.
 * @param name - Variable name
 * @param fallback - Value when unset or empty
 * @param bounds - Inclusive range the value must fall in
 * @returns The parsed integer
 * @throws {Error} When the value is not an integer in range
 */
export function intEnv(name: string, fallback: number, bounds?: { min?: number; max?: number }): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const value = Number(raw);
  const { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY } = bounds ?? {};
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Environment variable ${name} must be an integer in [${min}, ${max}], got ${JSON.stringify(raw)}`);
  }
  return value;
}

/** The R2 connection every writer needs. */
export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

/**
 * Read the R2 connection.
 *
 * Fifteen entrypoints assembled this by hand. Some accept `CLOUDFLARE_ACCOUNT_ID`
 * where others require `R2_ACCOUNT_ID`, and some default the bucket while others
 * demand it — so the same workflow secrets could satisfy one script and fail
 * another. One reader, one answer.
 * @param options - `defaultBucket` makes R2_BUCKET_NAME optional, matching the
 *   workflows that pass `secrets.R2_BUCKET_NAME || 'ciphermaniac-reports'`
 * @returns The connection, credentials included but never logged
 */
export function r2Config(options: { defaultBucket?: string } = {}): R2Config {
  return {
    // Both names appear across the workflows; accept either rather than making
    // the caller know which one their job happens to set.
    accountId: process.env.R2_ACCOUNT_ID?.trim() || requireEnv('CLOUDFLARE_ACCOUNT_ID'),
    accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
    secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
    bucket: options.defaultBucket ? optionalEnv('R2_BUCKET_NAME', options.defaultBucket) : requireEnv('R2_BUCKET_NAME')
  };
}

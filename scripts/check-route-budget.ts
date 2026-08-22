#!/usr/bin/env tsx
/**
 * Compare the newest route benchmark against an earlier one.
 *
 * DB-MASTER-PLAN Phase 12.5 states the budgets in terms of what a change is
 * allowed to do, not absolute numbers:
 *
 *   - no unexplained additional blocking request
 *   - no material transferred-byte increase
 *   - no significant p95 regression
 *
 * Absolute thresholds would be wrong here. These runs hit live R2, so an
 * absolute gate measures the CDN's mood as much as the bundle — which is
 * exactly why the plan says to treat them as trend measurements rather than
 * brittle per-PR gates. This is therefore a REPORT: it exits non-zero so it can
 * be used as a gate deliberately, but it is not wired into `verify`.
 *
 * Usage:
 *   npx tsx scripts/check-route-budget.ts                    # newest vs previous
 *   npx tsx scripts/check-route-budget.ts 2026-07-12         # newest vs a date
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const BASELINES = join(dirname(fileURLToPath(import.meta.url)), '../.github/baselines');

/** Budgets, as the plan words them. */
const BUDGET = {
  /** An added blocking request is the one thing with a hard zero. */
  requests: 0,
  /** "Material" transferred-byte increase. */
  bytesPct: 10,
  /** "Significant" p95 regression, per the Phase 0 rule: min(5%, 50ms). */
  timePct: 5,
  timeMs: 50
};

interface RouteMetrics {
  requestCount: number;
  transferredBytesTotal: number;
  lcpMs: number;
  firstDataMs: number;
  nonOkResponses?: number;
}

interface Benchmark {
  date: string;
  routes: Array<{ route: string; cold: RouteMetrics; repeat: RouteMetrics }>;
}

function load(date: string): Benchmark {
  return JSON.parse(readFileSync(join(BASELINES, `route-benchmark-${date}.json`), 'utf8')) as Benchmark;
}

const dates = readdirSync(BASELINES)
  .map(f => /^route-benchmark-(.+)\.json$/.exec(f)?.[1])
  .filter((d): d is string => Boolean(d))
  .sort();

if (dates.length < 2) {
  console.log('Need at least two benchmarks to compare.');
  process.exit(0);
}

const currentDate = dates[dates.length - 1];
const baseDate = process.argv[2] ?? dates[dates.length - 2];
if (!dates.includes(baseDate)) {
  console.error(`No benchmark for ${baseDate}. Have: ${dates.join(', ')}`);
  process.exit(1);
}

const current = load(currentDate);
const base = load(baseDate);
console.log(`route budget: ${baseDate} -> ${currentDate}\n`);

const baseByRoute = new Map(base.routes.map(r => [r.route, r]));
const regressions: string[] = [];
const improvements: string[] = [];

function pct(from: number, to: number): number {
  return from === 0 ? (to === 0 ? 0 : 100) : ((to - from) / from) * 100;
}

for (const row of current.routes) {
  const was = baseByRoute.get(row.route);
  if (!was) {
    console.log(`  ${row.route}: new route, no baseline`);
    continue;
  }
  const reqDelta = row.cold.requestCount - was.cold.requestCount;
  const byteDelta = pct(was.cold.transferredBytesTotal, row.cold.transferredBytesTotal);
  const lcpDelta = row.cold.lcpMs - was.cold.lcpMs;
  const lcpPct = pct(was.cold.lcpMs, row.cold.lcpMs);

  const flags: string[] = [];
  if (reqDelta > BUDGET.requests) {
    flags.push(`+${reqDelta} request(s)`);
  }
  if (byteDelta > BUDGET.bytesPct) {
    flags.push(`+${byteDelta.toFixed(0)}% bytes`);
  }
  // Both must be exceeded: the plan's rule is min(5%, 50ms), so a small
  // absolute move on a fast route is not a regression and neither is a large
  // percentage of a tiny number.
  if (lcpPct > BUDGET.timePct && lcpDelta > BUDGET.timeMs) {
    flags.push(`+${lcpDelta.toFixed(0)}ms LCP (${lcpPct.toFixed(0)}%)`);
  }

  const summary =
    `${String(reqDelta > 0 ? `+${reqDelta}` : reqDelta).padStart(4)} req  ` +
    `${(byteDelta >= 0 ? '+' : '') + byteDelta.toFixed(0)}% bytes  ` +
    `${(lcpDelta >= 0 ? '+' : '') + lcpDelta.toFixed(0)}ms LCP`;

  if (flags.length) {
    // A timing move with no request or byte change has no structural cause, so
    // on a live-network run it is almost certainly noise. Still reported — but
    // labelled, because "LCP is up and nothing else moved" and "LCP is up and
    // we added four requests" deserve different reactions.
    const structural = reqDelta > 0 || byteDelta > BUDGET.bytesPct;
    regressions.push(`${row.route}: ${flags.join(', ')}${structural ? '' : ' (timing only, no structural change)'}`);
    console.log(`  REGRESSED  ${row.route.padEnd(24)} ${summary}`);
  } else if (reqDelta < 0 || byteDelta < -10) {
    improvements.push(row.route);
    console.log(`  improved   ${row.route.padEnd(24)} ${summary}`);
  } else {
    console.log(`  ok         ${row.route.padEnd(24)} ${summary}`);
  }
}

console.log();
if (improvements.length) {
  console.log(`${improvements.length} route(s) improved.`);
}
if (regressions.length) {
  console.error(`${regressions.length} route(s) over budget:`);
  for (const r of regressions) {
    console.error(`  ${r}`);
  }
  console.error('\nThese runs hit live R2, so confirm against a second run before treating this as a code regression.');
  process.exit(1);
}
console.log('No route is over budget.');

#!/usr/bin/env tsx
/**
 * Design-system drift check.
 *
 * A style guide that only documents the system is a suggestion. This is the
 * part that enforces it: every rule below encodes a ruling from /style, and
 * anything new that breaks one fails the build.
 *
 * Existing drift is not blocked — it is recorded in the baseline file and may
 * only ever shrink. That keeps the check shippable on a codebase mid-migration
 * while still making it impossible to add more. When a ruling is applied
 * everywhere, its baseline entries disappear and the check gets stricter for
 * free. A baseline entry that no longer matches anything is also a failure, so
 * the file cannot rot into a permanent amnesty.
 *
 * Usage:
 *   npx tsx scripts/check-design-drift.ts            # fail on new drift
 *   npx tsx scripts/check-design-drift.ts --list     # print every finding
 *   npx tsx scripts/check-design-drift.ts --update   # re-record the baseline
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = join(ROOT, 'config', 'design-drift-baseline.json');
const UPDATE = process.argv.includes('--update');
const LIST = process.argv.includes('--list');

/**
 * Sheets that draw something other than UI. The social graphics canvas exports
 * at a fixed scale and must look identical in both modes, so it cannot read
 * live tokens; the label maker draws physical thermal ink on physical stock.
 * Both are documented exceptions on /style.
 */
const EXEMPT_SHEETS = ['pages/social-graphics.css', 'pages/label-maker.css'];

/** Sizes on the named scale in tokens.css, plus those still pending a ruling. */
const SCALE = new Set([9, 10.5, 11, 12, 13, 15, 18, 22, 30]);
/** Not yet on the scale — tracked by the "Type scale" ruling, allowed for now. */
const PENDING_SIZES = new Set([14, 16, 17]);
/** One-off display sizes: hero overrides, the survey completion screen. */
const DISPLAY_SIZES = new Set([19, 20, 26, 28, 32, 40]);

/** Literal px values that have a radius token and should use it. */
const RADIUS_TOKENS: Record<string, string> = {
  '3px': '--radius-sm',
  '5px': '--radius-md',
  '14px': '--radius-lg',
  '999px': '--radius-pill'
};

interface Finding {
  /** Stable identity across line moves: sheet + rule id + selector. */
  key: string;
  file: string;
  line: number;
  rule: string;
  message: string;
}

interface CssRule {
  selector: string;
  body: string;
  line: number;
}

/** Flat split into top-level-ish rules. Enough for declaration-level checks. */
function parseRules(source: string): CssRule[] {
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, comment => comment.replace(/[^\n]/g, ' '));
  const rules: CssRule[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(stripped)) !== null) {
    const selector = match[1].trim().replace(/\s+/g, ' ');
    if (!selector || selector.startsWith('@')) {
      continue;
    }
    rules.push({
      selector,
      body: match[2],
      line: stripped.slice(0, match.index).split('\n').length
    });
  }
  return rules;
}

function decl(body: string, prop: string): string | undefined {
  const re = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i');
  return re.exec(body)?.[1]?.trim();
}

interface CheckContext {
  /** Selectors in this sheet that take a ring on behalf of a descendant. */
  focusWithin: string[];
}

interface Hit {
  rule: string;
  message: string;
}

type Check = (rule: CssRule, ctx: CheckContext) => Hit[];

const CHECKS: Check[] = [
  // Ruling: "Type scale". One named scale; no eyeballed half-steps.
  rule => {
    const value = decl(rule.body, 'font-size');
    if (!value || value.includes('var(') || value.includes('clamp(') || value.includes('em') || value === 'inherit') {
      return [];
    }
    const px = Number.parseFloat(value);
    if (Number.isNaN(px) || SCALE.has(px) || PENDING_SIZES.has(px) || DISPLAY_SIZES.has(px)) {
      return [];
    }
    if (/\bimg\b/.test(rule.selector)) {
      return []; // sizes alt text when the image 404s, not typography
    }
    return [
      {
        rule: 'type-scale',
        message: `font-size: ${value} is off the scale (tokens.css names 9/10.5/11/12/13/15/18/22/30)`
      }
    ];
  },

  // Ruling: "Offset shadow". Three tiers, and the ink is never restated.
  rule => {
    const value = decl(rule.body, 'box-shadow');
    if (!value || value === 'none' || value.includes('var(--shadow') || value.includes('var(--focus-ring')) {
      return [];
    }
    if (/^\s*inset\b/.test(value) || value.includes('0 0 0')) {
      return []; // hairlines and rings, handled by their own checks
    }
    if (/-?\d+px\s+-?\d+px\s+0\s+0/.test(value)) {
      return [
        {
          rule: 'shadow-token',
          message: `hardcoded flat offset shadow "${value}" — use --shadow-1 / --shadow-2 / --shadow-press`
        }
      ];
    }
    // A shadow's third length is its blur radius. The system has none.
    const lengths = value.split(/\s+/).filter(part => /^-?\d*\.?\d+(px|rem|em)?$/.test(part));
    const blur = lengths[2];
    if (blur !== undefined && Number.parseFloat(blur) !== 0) {
      return [{ rule: 'no-blur-shadow', message: `blurred shadow "${value}" — the system is flat offsets only` }];
    }
    return [];
  },

  // Ruling: "Chip shape" / shape tokens. A literal that has a token must use it.
  rule => {
    const value = decl(rule.body, 'border-radius');
    if (!value || value.includes('var(')) {
      return [];
    }
    const token = RADIUS_TOKENS[value.trim()];
    return token ? [{ rule: 'radius-token', message: `border-radius: ${value} — use var(${token})` }] : [];
  },

  // Ruling: "Focus indicator". One ring, one opacity, via the token.
  (rule, ctx) => {
    const found: Hit[] = [];
    const shadow = decl(rule.body, 'box-shadow');
    if (shadow && /0 0 0 3px color-mix/.test(shadow)) {
      found.push({ rule: 'focus-ring-token', message: 'hand-rolled focus ring — use var(--focus-ring)' });
    }
    const outline = decl(rule.body, 'outline');
    const base = rule.selector.replace(/:focus(-visible)?\b.*$/, '').trim();
    const ancestorRings = ctx.focusWithin.some(sel => base.startsWith(sel) && base !== sel);
    if (outline === 'none' && !shadow && !/:focus-within/.test(rule.selector) && !ancestorRings) {
      found.push({ rule: 'focus-suppressed', message: 'outline: none with no replacement ring' });
    }
    return found;
  },

  // Ruling: "Micro-label". One uppercase recipe, at 0.08em.
  rule => {
    if (decl(rule.body, 'text-transform') !== 'uppercase') {
      return [];
    }
    const tracking = decl(rule.body, 'letter-spacing');
    if (!tracking || tracking === '0.08em') {
      return [];
    }
    return [
      { rule: 'micro-label', message: `uppercase label at ${tracking} — the house recipe is .label-micro at 0.08em` }
    ];
  },

  // Ruling: disabled state. One opacity, one cursor.
  rule => {
    if (!/:disabled|\[disabled\]|\[aria-disabled='true'\]|\.disabled\b/.test(rule.selector)) {
      return [];
    }
    const opacity = decl(rule.body, 'opacity');
    if (!opacity || opacity === '0.4') {
      return [];
    }
    return [{ rule: 'disabled-state', message: `disabled opacity ${opacity} — the house value is 0.4` }];
  }
];

function sheetFiles(): string[] {
  return execSync('git ls-files src/styles', { cwd: ROOT, encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(f => f.endsWith('.css'));
}

function collectFindings(): Finding[] {
  const findings: Finding[] = [];
  for (const file of sheetFiles()) {
    const short = file.replace('src/styles/', '');
    if (EXEMPT_SHEETS.includes(short)) {
      continue;
    }
    const rules = parseRules(readFileSync(join(ROOT, file), 'utf8'));
    const ctx: CheckContext = {
      focusWithin: rules
        .filter(r => r.selector.includes(':focus-within'))
        .map(r => r.selector.replace(':focus-within', '').trim())
    };
    for (const rule of rules) {
      for (const check of CHECKS) {
        for (const hit of check(rule, ctx)) {
          findings.push({
            key: `${short}|${hit.rule}|${rule.selector}`,
            file: short,
            line: rule.line,
            rule: hit.rule,
            message: hit.message
          });
        }
      }
    }
  }
  return findings;
}

/**
 * The namespacing ruling, checked across sheets rather than within one.
 *
 * Only an *identical selector* in two sheets is flagged. A page sheet adding
 * `.data td.mb-cell` to the shared table is extension and fine; two sheets both
 * writing `.snapshot-banner { ... }` is a conflict decided by load order, where
 * the loser is invisible and editing it appears to do nothing.
 */
function collectCollisions(): Finding[] {
  const owners = new Map<string, Set<string>>();
  for (const file of sheetFiles()) {
    const short = file.replace('src/styles/', '');
    if (short === 'tokens.css' || short === 'fonts.css') {
      continue;
    }
    for (const rule of parseRules(readFileSync(join(ROOT, file), 'utf8'))) {
      for (const selector of rule.selector.split(',').map(x => x.trim())) {
        if (!selector.startsWith('.')) {
          continue;
        }
        const set = owners.get(selector) ?? new Set<string>();
        set.add(short);
        owners.set(selector, set);
      }
    }
  }
  const findings: Finding[] = [];
  for (const [selector, sheets] of [...owners].sort()) {
    if (sheets.size < 2) {
      continue;
    }
    const list = [...sheets].sort();
    findings.push({
      key: `${list.join(',')}|selector-collision|${selector}`,
      file: list[0],
      line: 0,
      rule: 'selector-collision',
      message: `"${selector}" is declared in ${list.join(' and ')} — load order decides which wins`
    });
  }
  return findings;
}

function writeBaseline(keys: string[]): void {
  const unique = [...new Set(keys)].sort();
  writeFileSync(
    BASELINE,
    `${JSON.stringify(
      {
        note: 'Known design drift, recorded so new drift fails the build. This list may only shrink — see scripts/check-design-drift.ts and the ledger on /style.',
        generated: new Date().toISOString().slice(0, 10),
        allowed: unique
      },
      null,
      2
    )}\n`
  );
  console.log(`design-drift: baseline updated with ${unique.length} known findings`);
}

function report(findings: Finding[], allowed: Set<string>): void {
  for (const f of [...findings].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
    console.log(`  ${allowed.has(f.key) ? 'known' : ' NEW '}  ${f.file}:${f.line}  [${f.rule}] ${f.message}`);
  }
  console.log(`\n${findings.length} findings, ${findings.filter(f => !allowed.has(f.key)).length} new`);
}

function runCheck(findings: Finding[]): void {
  const baseline: string[] = JSON.parse(readFileSync(BASELINE, 'utf8')).allowed;
  const allowed = new Set(baseline);
  const added = findings.filter(f => !allowed.has(f.key));
  const seen = new Set(findings.map(f => f.key));
  const stale = baseline.filter(k => !seen.has(k));

  if (LIST) {
    report(findings, allowed);
  }

  if (added.length > 0) {
    console.error(`\ndesign-drift: ${added.length} new violation(s) — see the drift ledger on /style\n`);
    for (const f of added) {
      console.error(`  ${f.file}:${f.line}  [${f.rule}] ${f.message}`);
    }
    console.error('\nFix them, or if the drift is deliberate, run: npx tsx scripts/check-design-drift.ts --update');
    process.exit(1);
  }

  if (stale.length > 0) {
    console.error(`\ndesign-drift: ${stale.length} baseline entr(ies) no longer match anything.`);
    console.error('That usually means a ruling got applied — good. Re-record with --update so the check tightens:\n');
    for (const k of stale) {
      console.error(`  ${k}`);
    }
    process.exit(1);
  }

  console.log(`design-drift: no new drift (${baseline.length} known, tracked on /style)`);
}

const allFindings = [...collectFindings(), ...collectCollisions()];
if (UPDATE) {
  writeBaseline(allFindings.map(f => f.key));
} else {
  runCheck(allFindings);
}

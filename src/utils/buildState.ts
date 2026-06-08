/**
 * Filter-rule state, plus a compact URL (de)serialization so a "build" (the
 * set of include/exclude rules + success bracket + inclusion threshold) can be
 * shared as a link and survive a reload.
 *
 * Format:
 *   b = rules as `cardId:mode:op:count` segments joined by `,`
 *       mode  i=include  x=exclude
 *       op    g=>=  e==  l=<=
 *   s = success bracket (omitted when "all")
 *   t = inclusion threshold (omitted when 60)
 *
 * Only the persistable core of a rule survives — the panel re-hydrates the
 * display fields (name/set/number) from the archetype report on load.
 */

export type RuleMode = 'include' | 'exclude';
export type CountOp = '>=' | '=' | '<=';

export interface Rule {
  id: number;
  cardId: string;
  name: string;
  set?: string;
  number?: string | number;
  mode: RuleMode;
  countOp: CountOp;
  count: number;
}

export interface BuildState {
  rules: Rule[];
  successFilter: string;
  threshold: number;
}

/** The subset of a rule that round-trips through the URL. */
export interface PersistedRule {
  cardId: string;
  mode: RuleMode;
  countOp: CountOp;
  count: number;
}

export interface DecodedBuildState {
  rules: PersistedRule[];
  successFilter?: string;
  threshold?: number;
}

export const DEFAULT_THRESHOLD = 60;
export const DEFAULT_SUCCESS = 'all';

const OP_TO_CODE: Record<CountOp, string> = { '>=': 'g', '=': 'e', '<=': 'l' };
const CODE_TO_OP: Record<string, CountOp> = { g: '>=', e: '=', l: '<=' };

export function encodeBuildState(state: BuildState): Record<string, string> {
  const params: Record<string, string> = {};

  const segments = (state.rules ?? [])
    .filter(rule => rule && typeof rule.cardId === 'string' && rule.cardId)
    .map(rule => {
      const mode = rule.mode === 'exclude' ? 'x' : 'i';
      const op = OP_TO_CODE[rule.countOp] ?? 'g';
      const count = Number.isFinite(rule.count) ? Math.max(0, Math.trunc(rule.count)) : 1;
      return `${rule.cardId}:${mode}:${op}:${count}`;
    });
  if (segments.length) {
    params.b = segments.join(',');
  }
  if (state.successFilter && state.successFilter !== DEFAULT_SUCCESS) {
    params.s = state.successFilter;
  }
  if (Number.isFinite(state.threshold) && state.threshold !== DEFAULT_THRESHOLD) {
    params.t = String(state.threshold);
  }
  return params;
}

export function decodeBuildState(params: Record<string, string | undefined>): DecodedBuildState {
  const out: DecodedBuildState = { rules: [] };

  const { b } = params;
  if (typeof b === 'string' && b) {
    for (const segment of b.split(',')) {
      const parts = segment.split(':');
      if (parts.length !== 4) {
        continue;
      }
      const [cardId, modeCode, opCode, countStr] = parts;
      if (!cardId || (modeCode !== 'i' && modeCode !== 'x')) {
        continue;
      }
      const countOp = CODE_TO_OP[opCode];
      if (!countOp) {
        continue;
      }
      const count = Number.parseInt(countStr, 10);
      if (!Number.isFinite(count) || count < 0) {
        continue;
      }
      out.rules.push({ cardId, mode: modeCode === 'x' ? 'exclude' : 'include', countOp, count });
    }
  }

  if (typeof params.s === 'string' && params.s) {
    out.successFilter = params.s;
  }
  if (typeof params.t === 'string' && params.t) {
    const t = Number.parseInt(params.t, 10);
    if (Number.isFinite(t) && t >= 0 && t <= 100) {
      out.threshold = t;
    }
  }
  return out;
}

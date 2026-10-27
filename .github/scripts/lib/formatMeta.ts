/**
 * Builds every non-Standard format's report and the index that lists them.
 *
 * Each format is the Standard online meta's producer pointed at a different
 * scope (see shared/formats/registry). A format that fails keeps whatever it
 * last published and is named in the index's `failed` list, so one quiet or
 * broken format never holds back the others or the Standard data beside them.
 */

import {
  FORMAT_SCOPES,
  formatFolder,
  FORMATS_INDEX_PATH,
  type FormatScope,
  type FormatsIndex,
  type FormatsIndexEntry
} from '../../../shared/formats/registry';
import { windowDays } from '../../../shared/formats/window';
import {
  type ArchetypeRule,
  matchArchetypeRule,
  ruleIcons,
  ruleThumbnails
} from '../../../shared/formats/archetypeRules';
import eternalRules from '../../../config/archetypes/eternal.json' with { type: 'json' };
import { BANLIST_FILE, type FormatBanlist } from '../../../shared/formats/banlist';
import { fetchEternalBanlist } from './eternalBanlist';
import { type OnlineMetaOptions, type ReportScope, runOnlineMeta } from './onlineMeta';

export interface FormatMetaOptions extends Omit<OnlineMetaOptions, 'scope' | 'exclusions' | 'thumbnails'> {
  formats?: readonly FormatScope[];
  /** Hand-picked card thumbnails per format, keyed by archetype label. */
  thumbnails?: Record<string, Record<string, string[]>>;
  /** Hand-picked sprite icons per format, keyed by archetype label. */
  icons?: Record<string, Record<string, string[]>>;
  /** Reads a ban list source as JSON. Default: `fetch`. */
  fetchBanlistJson?: (url: string) => Promise<unknown>;
}

type BanlistLoader = (fetchJson: (url: string) => Promise<unknown>, now: Date) => Promise<FormatBanlist>;

/** Formats with a ban list worth showing, and where each one's list comes from. */
const FORMAT_BANLISTS: Record<string, BanlistLoader> = {
  eternal: fetchEternalBanlist
};

async function fetchJsonFromWeb(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`${url} answered ${response.status}`);
  }
  return response.json();
}

/** Hand-maintained archetype rules, for formats Limitless leaves unclassified. */
const FORMAT_RULES: Record<string, readonly ArchetypeRule[]> = {
  eternal: eternalRules.archetypes
};

/** The producer scope for one format. */
export function formatReportScope(format: FormatScope, now: Date, icons: Record<string, string[]> = {}): ReportScope {
  const { source } = format;
  const rules = FORMAT_RULES[format.id] ?? [];
  return {
    folder: formatFolder(format.id).replace(/^reports\//, ''),
    name: format.label,
    windowDays: windowDays(format.window, now),
    fetch: {
      formats: [source.format],
      query: { format: source.format, ...(source.organizerId ? { organizerId: source.organizerId } : {}) },
      ...(source.nameIncludes ? { nameIncludes: source.nameIncludes } : {})
    },
    minFieldPlayers: format.minFieldPlayers,
    minMatchupFieldPlayers: format.minMatchupFieldPlayers,
    ...(FORMAT_BANLISTS[format.id] ? { keep: [BANLIST_FILE] } : {}),
    icons: { ...ruleIcons(rules), ...icons },
    ...(rules.length ? { classify: deck => matchArchetypeRule(deck.cards, rules)?.name ?? null } : {})
  };
}

function indexEntry(format: FormatScope, meta: Record<string, unknown>): FormatsIndexEntry {
  return {
    id: format.id,
    label: format.label,
    window: format.windowLabel,
    events: Number(meta.tournamentCount) || 0,
    decks: Number(meta.deckTotal) || 0,
    windowStart: String(meta.windowStart ?? ''),
    windowEnd: String(meta.windowEnd ?? '')
  };
}

type FormatOutcome = { entry: FormatsIndexEntry } | { failure: { id: string; message: string } };

/** Build one format's report; a failure is caught and reported rather than thrown. */
async function runFormat(format: FormatScope, options: FormatMetaOptions): Promise<FormatOutcome> {
  const { formats: _formats, thumbnails = {}, icons = {}, ...shared } = options;
  try {
    const meta = await runOnlineMeta({
      ...shared,
      exclusions: {},
      thumbnails: { ...ruleThumbnails(FORMAT_RULES[format.id] ?? []), ...thumbnails[format.id] },
      scope: formatReportScope(format, shared.now, icons[format.id])
    });
    return { entry: indexEntry(format, meta) };
  } catch (error) {
    return { failure: { id: format.id, message: (error as Error)?.message || String(error) } };
  }
}

/**
 * Refresh a format's ban list beside its report. A failed read keeps the
 * previous list rather than publishing none.
 */
async function publishBanlist(format: FormatScope, options: FormatMetaOptions): Promise<void> {
  const load = FORMAT_BANLISTS[format.id];
  if (!load) {
    return;
  }
  const folder = formatFolder(format.id).replace(/^reports\//, '');
  try {
    const banlist = await load(options.fetchBanlistJson ?? fetchJsonFromWeb, options.now);
    await options.store.write(`${options.reportsPrefix}/${folder}/${BANLIST_FILE}`, banlist);
  } catch (error) {
    (options.warn ?? console.warn)(`[format-meta] ${format.id} ban list not refreshed: ${(error as Error)?.message}`);
  }
}

/**
 * Build every format, then write the index. Resolves with the index written.
 * @param options - Store, Limitless client, clock, and per-format overrides
 */
export async function runFormatMetas(options: FormatMetaOptions): Promise<FormatsIndex> {
  const { store, now, reportsPrefix, formats = FORMAT_SCOPES } = options;
  const warn = options.warn ?? (message => console.warn(message));
  // Keys follow the run's reports prefix, which is `reports` in production.
  const indexKey = `${reportsPrefix}/${FORMATS_INDEX_PATH.replace(/^reports\//, '')}`;
  const previous = await store.read<FormatsIndex>(indexKey);
  const entries: FormatsIndexEntry[] = [];
  const failed: NonNullable<FormatsIndex['failed']> = [];

  for (const format of formats) {
    const outcome = await runFormat(format, options);
    await publishBanlist(format, options);
    if ('entry' in outcome) {
      entries.push(outcome.entry);
      continue;
    }
    warn(`[format-meta] ${format.id} failed; keeping its previous report: ${outcome.failure.message}`);
    failed.push(outcome.failure);
    const kept = previous?.formats.find(entry => entry.id === format.id);
    if (kept) {
      entries.push(kept);
    }
  }

  const index: FormatsIndex = {
    generatedAt: now.toISOString(),
    formats: entries,
    ...(failed.length ? { failed } : {})
  };
  await store.write(indexKey, index);
  return index;
}

import { ONLINE_META_LABEL, ONLINE_META_NAME } from '../../lib/constants';
import type { FormatsIndexEntry } from '../../../shared/formats/registry';
import { foldSearch } from '../../utils/searchFold';

/** Standard events shown before "More..." expands the list. */
export const RECENT_STANDARD_COUNT = 5;

/** What the selector's popover lists, in display order. */
export interface SelectorGroups {
  /** Whether the Online events row is shown. */
  online: boolean;
  /** Standard event keys, newest first. */
  standard: string[];
  /** Whether a "More..." button would reveal further Standard events. */
  hasMore: boolean;
  /** Published non-Standard formats, in registry order. */
  other: FormatsIndexEntry[];
}

export interface SelectorInput {
  /** Published keys, the online meta included. */
  keys: readonly string[];
  formats: readonly FormatsIndexEntry[];
  /** The search box's text. */
  query: string;
  /** Whether "More..." has been pressed. */
  expanded: boolean;
  /** The display label for a key, searched alongside the key itself. */
  label: (key: string) => string;
}

/**
 * Split the published scopes into the popover's groups. A search shows every
 * match, so "More..." only applies to the unfiltered list.
 */
export function selectorGroups({ keys, formats, query, expanded, label }: SelectorInput): SelectorGroups {
  const q = foldSearch(query.trim());
  const matches = (...texts: string[]) => !q || texts.some(text => foldSearch(text).includes(q));
  const standard = keys
    .filter(key => key !== ONLINE_META_NAME && matches(key, label(key)))
    .sort((a, b) => b.localeCompare(a));
  const capped = !q && !expanded && standard.length > RECENT_STANDARD_COUNT;
  return {
    online: keys.includes(ONLINE_META_NAME) && matches(ONLINE_META_NAME, ONLINE_META_LABEL),
    standard: capped ? standard.slice(0, RECENT_STANDARD_COUNT) : standard,
    hasMore: capped,
    other: formats.filter(format => matches(format.label, format.id))
  };
}

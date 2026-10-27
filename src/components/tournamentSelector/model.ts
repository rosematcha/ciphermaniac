import { ONLINE_META_LABEL, ONLINE_META_NAME } from '../../lib/constants';
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
}

/**
 * Split the published tournament keys into the popover's groups. A search
 * shows every match, so "More..." only applies to the unfiltered list.
 * @param keys - Published keys, the online meta included
 * @param query - The search box's text
 * @param expanded - Whether "More..." has been pressed
 * @param label - The display label for a key, searched alongside the key itself
 */
export function selectorGroups(
  keys: readonly string[],
  query: string,
  expanded: boolean,
  label: (key: string) => string
): SelectorGroups {
  const q = foldSearch(query.trim());
  const matches = (key: string, shown: string) => !q || foldSearch(key).includes(q) || foldSearch(shown).includes(q);
  const standard = keys
    .filter(key => key !== ONLINE_META_NAME && matches(key, label(key)))
    .sort((a, b) => b.localeCompare(a));
  const capped = !q && !expanded && standard.length > RECENT_STANDARD_COUNT;
  return {
    online: keys.includes(ONLINE_META_NAME) && matches(ONLINE_META_NAME, ONLINE_META_LABEL),
    standard: capped ? standard.slice(0, RECENT_STANDARD_COUNT) : standard,
    hasMore: capped
  };
}

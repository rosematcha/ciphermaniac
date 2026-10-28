/**
 * Every R2 key the City League source reads or writes. Card images live
 * outside this prefix, under `jp-card-images/` (see shared/data/japanOnlyCards).
 */
export const CITY_LEAGUES_PREFIX = 'sources/city-leagues/';
/** `events/{eventId}.json`: a parsed event page plus its listing row. Never refetched. */
export const EVENT_PREFIX = `${CITY_LEAGUES_PREFIX}events/`;
/** `lists/{listId}.json`: a parsed decklist. Never refetched. */
export const LIST_PREFIX = `${CITY_LEAGUES_PREFIX}lists/`;
/** Japanese print → English print, refreshed each run. */
export const PRINT_MAP_KEY = `${CITY_LEAGUES_PREFIX}print-map.json`;

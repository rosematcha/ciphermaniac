import { lazy } from 'solid-js';
import { WhileEventsOn } from './LiveBanner';

/**
 * The run drags in the deck reporter and the typeahead behind it. A career page
 * is opened far more often on a day with no event than on one with, so none of
 * that belongs in the profile's own bundle.
 */
const PlayerRun = lazy(() => import('../pages/live/PlayerRun').then(m => ({ default: m.PlayerRun })));

/**
 * A player's run at each event that is on, on their career page.
 *
 * This is where the run lives now — the live page used to open it inline above
 * a seven-hundred-row table, which on a phone meant the list jumped out from
 * under the finger that tapped it.
 */
export function LivePlayerRun(props: { playerId: string; name: string; countries: readonly string[] }) {
  return <WhileEventsOn>{event => <PlayerRun event={event} {...props} />}</WhileEventsOn>;
}

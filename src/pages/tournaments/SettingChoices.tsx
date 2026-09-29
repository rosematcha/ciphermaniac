/**
 * The settings choice beyond a switch that the new event setup and the
 * console's Event tab share: whether the event takes decklists. Apart from
 * SettingControls, which ships with the first page, so it loads with the
 * pages that use it.
 */

import type { DecklistMode } from '../../../shared/tournament/view';
import { Segmented } from '../../components/Segmented';

const DECKLIST_OPTIONS: { value: DecklistMode; label: string }[] = [
  { value: 'off', label: 'Disabled' },
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' }
];

/** Whether the event takes decklists, and if it does, whether players can send one now. */
export function DecklistsSwitch(props: { value: DecklistMode; onChange: (value: DecklistMode) => void }) {
  return (
    <Segmented options={DECKLIST_OPTIONS} selected={props.value} onSelect={props.onChange} ariaLabel='Decklists' />
  );
}

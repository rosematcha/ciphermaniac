/**
 * What a setting does, behind an info marker beside its label (SettingRow's
 * `info`), and the words for each event setting. Apart from SettingControls,
 * which ships with the first page, so the tooltip loads with the pages that
 * use it.
 */

import { InfoTip } from '../../components/InfoTip';

export const SETTING_INFO = {
  playerReporting: 'When enabled, allows players to report the results of their match via their personal devices.',
  archetypes:
    'Allows organizer entry of player deck archetypes. “Shown once the event ends” shows archetypes at the time of final standings and “Shown to everyone” shows archetypes at the time of entry during your event.',
  decklists:
    'Allows users to submit their decklists in TCGL format. “Open” makes decklists available during the event, and “Closed” disables decklist sharing.'
} as const;

export function SettingInfo(props: { text: string }) {
  return (
    <InfoTip marker='i' label={props.text}>
      {props.text}
    </InfoTip>
  );
}

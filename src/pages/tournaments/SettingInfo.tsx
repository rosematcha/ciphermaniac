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
    'Allows organizer entry of player deck archetypes. “Shown once the event ends” shows archetypes at the time of final standings and “Shown during the event” shows archetypes at the time of entry during your event.',
  decklists:
    'Allows users to submit their decklists in TCGL format. “Open” makes decklists available during the event, and “Closed” disables decklist sharing.'
} as const;

/** Player reporting's note, which at a sanctioned event also says where its results go. */
export const reportingInfo = (sanctioned: boolean) =>
  sanctioned
    ? `${SETTING_INFO.playerReporting} Mobile results write to the .tdf the same way manually entered results do.`
    : SETTING_INFO.playerReporting;

export function SettingInfo(props: { text: string }) {
  return (
    <InfoTip marker='i' label={props.text}>
      {props.text}
    </InfoTip>
  );
}

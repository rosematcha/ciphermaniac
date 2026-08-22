/**
 * The card wall's cast: Pokemon that currently lead an archetype or do heavy
 * lifting inside one.
 *
 * Curated, not derived. A usage query would churn the wall every day and drag
 * in whatever spiked overnight; this list is a deliberate portrait of the
 * format, so it is edited by hand when the meta actually moves. The printings
 * were resolved against the Online - Last 14 Days report on 2026-08-22 by
 * taking each name's most-played printing, which is the art players recognize.
 *
 * Numbers are the CDN's zero-padded form, so they can go straight into a
 * /thumbnails path (see cardWall/images).
 * @module src/lib/cardWall/roster
 */

/** One card in the wall. */
export interface WallCard {
  name: string;
  set: string;
  number: string;
}

export const WALL_ROSTER: readonly WallCard[] = [
  { name: 'Dragapult ex', set: 'PRE', number: '073' },
  { name: "N's Zoroark ex", set: 'JTG', number: '098' },
  { name: 'Mega Excadrill ex', set: 'PBL', number: '065' },
  { name: 'Dusknoir', set: 'SFA', number: '020' },
  { name: 'Blaziken ex', set: 'JTG', number: '024' },
  { name: 'Slowking', set: 'SCR', number: '058' },
  { name: 'Dipplin', set: 'TWM', number: '018' },
  { name: 'Thwackey', set: 'TWM', number: '015' },
  { name: 'Alakazam', set: 'MEG', number: '056' },
  { name: 'Dudunsparce', set: 'PRE', number: '080' },
  { name: "Marnie's Grimmsnarl ex", set: 'DRI', number: '136' },
  { name: 'Froslass', set: 'TWM', number: '053' },
  { name: 'Munkidori', set: 'TWM', number: '095' },
  { name: 'Dhelmise', set: 'MEP', number: '084' },
  { name: 'Raging Bolt ex', set: 'TEF', number: '123' },
  { name: 'Teal Mask Ogerpon ex', set: 'TWM', number: '025' },
  { name: 'Wellspring Mask Ogerpon ex', set: 'TWM', number: '064' },
  { name: 'Mega Lucario ex', set: 'MEG', number: '077' },
  { name: 'Solrock', set: 'MEG', number: '075' },
  { name: 'Lunatone', set: 'MEG', number: '074' },
  { name: 'Latias ex', set: 'SSP', number: '076' },
  { name: 'Mega Kangaskhan ex', set: 'MEG', number: '104' },
  { name: 'Toucannon', set: 'PBL', number: '068' },
  { name: "Lillie's Clefairy ex", set: 'JTG', number: '056' },
  { name: 'Mega Greninja ex', set: 'CRI', number: '022' },
  { name: "Cynthia's Garchomp ex", set: 'DRI', number: '104' },
  { name: "Team Rocket's Honchkrow", set: 'ASC', number: '127' },
  { name: 'Hydrapple ex', set: 'SCR', number: '014' },
  { name: 'Meganium', set: 'MEG', number: '010' },
  { name: 'Crustle', set: 'DRI', number: '012' },
  { name: 'Mega Lopunny ex', set: 'PFL', number: '084' },
  { name: 'Mega Starmie ex', set: 'POR', number: '021' },
  { name: 'Mega Absol ex', set: 'MEG', number: '086' },
  { name: 'Fezandipiti ex', set: 'SFA', number: '038' },
  { name: 'Meowth ex', set: 'POR', number: '062' },
  { name: 'Budew', set: 'PRE', number: '004' },
  { name: 'Yveltal', set: 'MEG', number: '088' },
  { name: 'Metang', set: 'TEF', number: '114' },
  { name: 'Pecharunt ex', set: 'SFA', number: '039' },
  { name: "N's Reshiram", set: 'JTG', number: '116' },
  { name: "N's Zekrom", set: 'ASC', number: '155' },
  { name: 'Fan Rotom', set: 'SCR', number: '118' },
  { name: 'Cornerstone Mask Ogerpon ex', set: 'TWM', number: '112' },
  { name: 'Cinccino ex', set: 'CRI', number: '073' },
  { name: 'Mega Darkrai ex', set: 'PBL', number: '048' },
  { name: 'Jellicent ex', set: 'WHT', number: '045' },
  { name: 'Pikachu ex', set: 'SSP', number: '057' },
  { name: 'Archaludon ex', set: 'SSP', number: '130' }
];

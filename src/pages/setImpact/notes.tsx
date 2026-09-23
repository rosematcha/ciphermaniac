import { InfoTip } from '../../components/InfoTip';

/** What each figure means, shown in the tooltips beside the labels. */
export const NOTES = {
  attribution:
    'New to Standard credits a reprint to the set that first made the card legal. Keeps it legal credits the oldest printing still legal at each event, so a reprint takes over once the original rotates.',
  majors:
    'Majors with a full top 8 on Limitless while the set was legal. Fewer than 8 and the set is shown but not ranked.',
  perMajor:
    "How many of the set's cards an average top 8 deck plays, counting each card once however many copies. 2.5 means two or three of its cards per deck.",
  lifetime:
    'Cards per deck added up over the years its majors cover, each major standing for the weeks around it. A set still legal shows what it has done so far.',
  mostPlayed: "The set's four most played cards. Hover one for its share of decks.",
  staples: 'The part of cards per deck that comes from cards in at least 40% of top 8 decks.',
  seen: "The share of the set's legal life its majors cover. The rest, a season not yet played or the pandemic gap, earns nothing."
};

export function Note(props: { text: string }) {
  return (
    <InfoTip marker='i' label={props.text}>
      {props.text}
    </InfoTip>
  );
}

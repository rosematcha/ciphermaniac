/**
 * The page's two event logos: the card backs and the Regional Championships
 * crest, served same-origin from static/img/reg-sim.
 */

export function CardStackMark(props: { small?: boolean }) {
  return (
    <img
      class='regsim-mark'
      classList={{ 'regsim-mark-small': props.small }}
      src='/img/reg-sim/tcg-card-backs.webp'
      width='300'
      height='279'
      alt=''
    />
  );
}

export function RibbonMark() {
  return (
    <img
      class='regsim-mark regsim-mark-ribbon'
      src='/img/reg-sim/regional-championships.webp'
      width='326'
      height='300'
      alt=''
    />
  );
}

/**
 * The page's two decorative marks, drawn here: a fanned stack of cards and a
 * ribbon. They stand where a registration page puts its event logos.
 */

export function CardStackMark(props: { small?: boolean }) {
  return (
    <svg class='regsim-mark' classList={{ 'regsim-mark-small': props.small }} viewBox='0 0 120 100' aria-hidden='true'>
      <rect x='22' y='18' width='44' height='62' rx='5' transform='rotate(-14 44 49)' fill='#4098D7' />
      <rect x='38' y='14' width='44' height='62' rx='5' fill='#E9B949' />
      <rect x='54' y='18' width='44' height='62' rx='5' transform='rotate(14 76 49)' fill='#E67635' />
      <circle cx='76' cy='49' r='9' fill='none' stroke='#fff' stroke-width='4' />
    </svg>
  );
}

export function RibbonMark() {
  return (
    <svg class='regsim-mark regsim-mark-ribbon' viewBox='0 0 100 100' aria-hidden='true'>
      <path d='M34 58 22 96l16-8 10 12 8-38zM66 58l12 38-16-8-10 12-8-38z' fill='#BA2525' />
      <circle cx='50' cy='40' r='32' fill='#E9B949' />
      <circle cx='50' cy='40' r='24' fill='none' stroke='#fff' stroke-width='4' />
      <path d='m50 25 4.4 9 9.9 1.4-7.2 7 1.7 9.8L50 47.6l-8.8 4.6 1.7-9.8-7.2-7 9.9-1.4z' fill='#fff' />
    </svg>
  );
}

/**
 * The /host home page's pictures: one 160 x 120 canvas each, one stroke
 * weight, marigold for whatever moves. Each does its one thing while its
 * point is on screen (tournament-home.css, under `.is-in`) and rests under
 * reduced motion.
 */

import { createSignal, createUniqueId, For, type JSX, onCleanup } from 'solid-js';
import { R2_ORIGIN } from '../../lib/constants';

const spriteUrl = (name: string) => `${R2_ORIGIN}/pokemon-sprites/gen9/${name}.png`;
const cardUrl = (set: string, num: string) => `${R2_ORIGIN}/card-images/${set}/${set}_${num}_R_EN_SM.webp`;

type Box = [x: number, y: number, w: number, h: number];

/** The feature pictures all fit this box, so cropping to it puts each drawing's edge where the canvas's was. */
const FEATURE_BOX: Box = [12, 14, 136, 92];

/**
 * A picture's canvas, cropped to `box` when given: the drawing's own outline.
 * `--w` carries the crop's width, so a layout can draw every picture at one
 * scale (tournament-home.css).
 */
function Canvas(props: { children: JSX.Element; box?: Box }) {
  const box = () => props.box ?? [0, 0, 160, 120];
  return (
    <svg
      viewBox={box().join(' ')}
      style={{ '--w': box()[2] }}
      fill='none'
      stroke='currentColor'
      stroke-width='2'
      stroke-linecap='round'
      stroke-linejoin='round'
      aria-hidden='true'
    >
      {props.children}
    </svg>
  );
}

function Sprite(props: { name: string; x: number; y: number; size: number }) {
  return (
    <image
      class='tm-art-sprite'
      href={spriteUrl(props.name)}
      x={props.x}
      y={props.y}
      width={props.size}
      height={props.size}
    />
  );
}

/** A card at width `w`, turned `rot` degrees about its centre, with an outline over the scan's edge. */
function Card(props: { set: string; num: string; x: number; y: number; w: number; rot?: number }) {
  const h = () => props.w * 1.4;
  return (
    <g transform={`rotate(${props.rot ?? 0} ${props.x + props.w / 2} ${props.y + h() / 2})`}>
      <image
        href={cardUrl(props.set, props.num)}
        x={props.x}
        y={props.y}
        width={props.w}
        height={h()}
        preserveAspectRatio='xMidYMid slice'
      />
      <rect x={props.x} y={props.y} width={props.w} height={h()} rx='2' stroke-width='1' />
    </g>
  );
}

function Text(props: {
  x: number;
  y: number;
  size: number;
  children: JSX.Element;
  class?: string;
  anchor?: 'start' | 'middle' | 'end';
  weight?: number;
}) {
  return (
    <text
      class={props.class}
      x={props.x}
      y={props.y}
      text-anchor={props.anchor ?? 'middle'}
      font-size={String(props.size)}
      font-weight={String(props.weight ?? 800)}
      stroke='none'
      fill='currentColor'
    >
      {props.children}
    </text>
  );
}

/** A grey bar standing in for a name. */
const Bar = (props: { x: number; y: number; w: number; class?: string }) => (
  <path class={props.class} d={`M${props.x} ${props.y}h${props.w}`} />
);

function Qr(props: { x: number; y: number }) {
  const dots: [number, number, number][] = [
    [3, 3, 5],
    [12, 3, 5],
    [3, 12, 5],
    [12, 12, 2.5],
    [14.5, 14.5, 2.5]
  ];
  return (
    <g>
      <rect x={props.x} y={props.y} width='20' height='20' rx='1.5' />
      <For each={dots}>
        {([dx, dy, size]) => (
          <rect x={props.x + dx} y={props.y + dy} width={size} height={size} fill='currentColor' stroke='none' />
        )}
      </For>
    </g>
  );
}

/** A tall phone: the table, the opponent, the three buttons, the first one pressed. */
export function PhoneArt() {
  return (
    <Canvas box={[53, 3, 54, 114]}>
      <rect x='54' y='4' width='52' height='112' rx='9' />
      <Bar x={74} y={11} w={12} />
      <Text x={80} y={30} size={7.5} class='tm-art-muted' weight={600}>
        Table
      </Text>
      <Text x={80} y={52} size={22}>
        7
      </Text>
      <Bar x={62} y={62} w={36} class='tm-art-soft' />
      <Sprite name='gardevoir' x={61} y={66} size={20} />
      <Bar x={84} y={73} w={13} />
      <Bar x={84} y={80} w={9} class='tm-art-soft' />
      <Bar x={62} y={92} w={36} class='tm-art-soft' />
      <rect class='tm-art-fill tm-art-press' x='61' y='98' width='11' height='10' rx='2' />
      <rect x='74.5' y='98' width='11' height='10' rx='2' />
      <rect x='88' y='98' width='11' height='10' rx='2' />
    </Canvas>
  );
}

/** A profile: picture, name, badges, then the events played, the newest landing on top. */
export function ProfileArt() {
  const clip = `tm-art-clip-${createUniqueId()}`;
  const old: [string, number, number, string][] = [
    ['dragapult', 71, 38, '3-2'],
    ['gardevoir', 87, 42, '2-3']
  ];
  return (
    <Canvas box={[17, 3, 126, 114]}>
      <rect x='18' y='4' width='124' height='112' rx='6' />
      <clipPath id={clip}>
        <circle cx='40' cy='26' r='13' />
      </clipPath>
      <g clip-path={`url(#${clip})`}>
        <Sprite name='dragapult' x={25} y={12} size={30} />
      </g>
      <circle cx='40' cy='26' r='13' />
      <Bar x={62} y={22} w={38} class='tm-art-strong' />
      <Bar x={62} y={32} w={24} class='tm-art-soft' />
      <path class='tm-art-fill' d='M118 20l5 3v6l-5 3-5-3v-6z' />
      <path d='M132 20l5 3v6l-5 3-5-3v-6z' />
      <Bar x={28} y={48} w={104} class='tm-art-soft' />
      <g class='tm-art-newrow'>
        <Sprite name='dragapult' x={28} y={55} size={14} />
        <Bar x={48} y={62} w={46} />
        <Text x={130} y={65} size={9} class='tm-art-ink' anchor='end'>
          4-1
        </Text>
      </g>
      <g class='tm-art-oldrows'>
        <For each={old}>
          {([name, y, w, record]) => (
            <>
              <Sprite name={name} x={28} y={y} size={14} />
              <Bar x={48} y={y + 7} w={w} />
              <Text x={130} y={y + 10} size={9} anchor='end'>
                {record}
              </Text>
            </>
          )}
        </For>
      </g>
    </Canvas>
  );
}

/** A round clock counting down from 30:19, a second at a time; it holds still under reduced motion. */
function useClock() {
  const [left, setLeft] = createSignal(30 * 60 + 19);
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const timer = setInterval(() => setLeft(s => Math.max(0, s - 1)), 1000);
    onCleanup(() => clearInterval(timer));
  }
  return () => `${String(Math.floor(left() / 60)).padStart(2, '0')}:${String(left() % 60).padStart(2, '0')}`;
}

const SCREEN_TABLES: [string, string][] = [
  ['dragapult', 'gardevoir'],
  ['charizard', 'gholdengo'],
  ['raging-bolt', 'crustle']
];

/** A TV: the round and its clock, three tables, and the QR code in the corner. */
export function ScreenArt() {
  const clock = useClock();
  return (
    <Canvas box={[7, 7, 146, 102]}>
      <rect x='8' y='8' width='144' height='88' rx='4' />
      <path d='M68 108h24M80 96v12' />
      <Text x={20} y={26} size={9} anchor='start' weight={700}>
        Round 3
      </Text>
      <Text x={140} y={28} size={16} class='tm-art-ink' anchor='end'>
        {clock()}
      </Text>
      <Bar x={20} y={34} w={120} class='tm-art-soft' />
      <For each={SCREEN_TABLES}>
        {([a, b], i) => (
          <>
            <Text x={23} y={49 + i() * 15} size={8} class='tm-art-muted' weight={700}>
              {i() + 1}
            </Text>
            <Sprite name={a} x={30} y={40 + i() * 15} size={12} />
            <Bar x={45} y={46 + i() * 15} w={22} />
            <Sprite name={b} x={72} y={40 + i() * 15} size={12} />
            <Bar x={87} y={46 + i() * 15} w={18} />
          </>
        )}
      </For>
      <Qr x={118} y={66} />
    </Canvas>
  );
}

/** A feature match on stream: two cards on the mat, then the overlay fades up in place and marks the win. */
export function StreamArt() {
  return (
    <Canvas box={[9, 5, 142, 100]}>
      <rect x='10' y='6' width='140' height='98' rx='4' />
      <Card set='TWM' num='130' x={45} y={16} w={33} rot={-6} />
      <Card set='OBF' num='125' x={82} y={15} w={33} rot={6} />
      <g class='tm-art-lower'>
        <rect x='18' y='76' width='54' height='18' rx='1.5' class='tm-art-plate' />
        <Sprite name='dragapult' x={20} y={77} size={16} />
        <path class='tm-art-light' d='M40 82h18' />
        <path class='tm-art-dim' d='M40 88h12' />
        <rect x='72' y='76' width='16' height='18' class='tm-art-chip' stroke='none' />
        <Text x={80} y={88.5} size={8} class='tm-art-chipt'>
          R3
        </Text>
        <rect x='88' y='76' width='54' height='18' rx='1.5' class='tm-art-plate' />
        <Sprite name='charizard' x={124} y={77} size={16} />
        <path class='tm-art-light' d='M96 82h24' />
        <path class='tm-art-dim' d='M106 88h14' />
        <g class='tm-art-win'>
          <rect x='60' y='79' width='10' height='12' rx='1' stroke='none' class='tm-art-chip' />
          <Text x={65} y={88} size={7.5} class='tm-art-chipt'>
            W
          </Text>
        </g>
      </g>
    </Canvas>
  );
}

/** A file's page at (x, y): folded corner, two rows, and the extension under them. */
function tdfFile(x: number, y: number) {
  return (
    <g>
      <path d={`M${x + 4} ${y}h24l12 12v36a4 4 0 0 1-4 4H${x + 4}a4 4 0 0 1-4-4V${y + 4}a4 4 0 0 1 4-4z`} />
      <path d={`M${x + 28} ${y}v8a4 4 0 0 0 4 4h8`} />
      <path class='tm-art-soft tm-art-r1' d={`M${x + 9} ${y + 16}h18`} />
      <path class='tm-art-soft' d={`M${x + 9} ${y + 24}h22`} />
      <Text x={x + 20} y={y + 46} size={11}>
        .tdf
      </Text>
    </g>
  );
}

/** A browser window at (x, y): three dots and three rows. */
function site(x: number, y: number) {
  return (
    <g>
      <rect x={x} y={y} width='40' height='52' rx='4' />
      <path d={`M${x} ${y + 11}h40`} />
      <For each={[6, 10.5, 15]}>
        {dx => <circle cx={x + dx} cy={y + 5.5} r='1.3' fill='currentColor' stroke='none' />}
      </For>
      <path class='tm-art-soft tm-art-r1' d={`M${x + 8} ${y + 20}h24`} />
      <path class='tm-art-soft' d={`M${x + 8} ${y + 28}h24`} />
      <path class='tm-art-soft' d={`M${x + 8} ${y + 36}h16`} />
    </g>
  );
}

/** A point on the sync circle, `deg` degrees clockwise from three o'clock. */
function onRing(deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180;
  return [80 + 13 * Math.cos(rad), 60 + 13 * Math.sin(rad)];
}

/** An arc of the sync circle from `from` to `to` degrees, clockwise, with its arrowhead at `to`. */
function ringArc(from: number, to: number): { arc: string; head: string } {
  const [x0, y0] = onRing(from);
  const [x1, y1] = onRing(to);
  const along = ((to + 90) * Math.PI) / 180;
  const head = [-35, 35]
    .map(turn => {
      const back = along + Math.PI + (turn * Math.PI) / 180;
      return `M${(x1 + 5 * Math.cos(back)).toFixed(2)} ${(y1 + 5 * Math.sin(back)).toFixed(2)}L${x1.toFixed(2)} ${y1.toFixed(2)}`;
    })
    .join('');
  return { arc: `M${x0.toFixed(2)} ${y0.toFixed(2)}A13 13 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`, head };
}

const RING = [ringArc(190, 340), ringArc(10, 160)];

/** The sync circle between a .tdf and the site turns once, both sides' top rows light, then it rests. */
export function TdfArt() {
  return (
    <Canvas box={[13, 33, 134, 54]}>
      {tdfFile(14, 34)}
      {site(106, 34)}
      <g class='tm-art-ring'>
        <For each={RING}>
          {({ arc, head }) => (
            <>
              <path d={arc} />
              <path d={head} />
            </>
          )}
        </For>
      </g>
    </Canvas>
  );
}

const RESULT_ROWS: [string, string][] = [
  ['raging-bolt', 'gholdengo'],
  ['gardevoir', 'crustle'],
  ['charizard', 'dragapult']
];

/** Three tables of a round: a win, a tie, and one still playing. */
export function ResultsArt() {
  return (
    <Canvas box={FEATURE_BOX}>
      <rect x='12' y='14' width='136' height='92' rx='4' />
      <Bar x={12} y={44} w={136} class='tm-art-soft' />
      <Bar x={12} y={74} w={136} class='tm-art-soft' />
      <For each={RESULT_ROWS}>
        {([a, b], i) => (
          <>
            <Sprite name={a} x={20} y={19 + i() * 30} size={20} />
            <Sprite name={b} x={46} y={19 + i() * 30} size={20} />
          </>
        )}
      </For>
      <Text x={138} y={33} size={12} class='tm-art-ink' anchor='end'>
        1–0
      </Text>
      <Text x={138} y={63} size={12} anchor='end'>
        Tie
      </Text>
      <Bar x={106} y={89} w={32} class='tm-art-soft' />
    </Canvas>
  );
}

/**
 * Two lists take turns behind Dragapult ex: Crushing Hammer and Unfair Stamp,
 * which pass, then Pidgeot ex and Lance, which don't. The second pair (`is-alt`)
 * swaps in while the cards are stacked, hidden behind the front card.
 */
const LIST_CARDS: [string, string, string][] = [
  ['tm-art-left', 'POR', '071'],
  ['tm-art-right', 'TWM', '165'],
  ['tm-art-left is-alt', 'OBF', '164'],
  ['tm-art-right is-alt', 'SIT', '159'],
  ['', 'TWM', '130']
];

/** Cards from a list spread from a stack, then a check lands on the front card's lower edge, or for the other list an X. */
export function DecklistArt() {
  return (
    <Canvas box={FEATURE_BOX}>
      <For each={LIST_CARDS}>
        {([side, set, num]) => (
          <g class={`tm-art-card ${side}`}>
            <Card set={set} num={num} x={56} y={16} w={48} />
          </g>
        )}
      </For>
      <g class='tm-art-check'>
        <circle cx='80' cy='90' r='16' class='tm-art-halo' />
        <circle class='tm-art-fill' cx='80' cy='90' r='13' />
        <path d='M73.5 90l4.5 4.5 8.5-9.5' stroke-width='2.5' />
      </g>
      <g class='tm-art-check is-alt'>
        <circle cx='80' cy='90' r='16' class='tm-art-halo' />
        <circle class='tm-art-plain' cx='80' cy='90' r='13' />
        <path d='M75 85l10 10M85 85l-10 10' stroke-width='2.5' />
      </g>
    </Canvas>
  );
}

/** Four decks of a field: share of the field as the bar's length, then match win rate. */
const FIELD: { name: string; share: number; rate: string }[] = [
  { name: 'dragapult', share: 76, rate: '58%' },
  { name: 'gardevoir', share: 56, rate: '53%' },
  { name: 'charizard', share: 42, rate: '49%' },
  { name: 'raging-bolt', share: 28, rate: '44%' }
];

/** What the field played: four decks, each bar growing to its share in turn, the leader in marigold. */
export function FieldArt() {
  return (
    <Canvas box={FEATURE_BOX}>
      <For each={FIELD}>
        {(deck, i) => (
          <>
            <Sprite name={deck.name} x={12} y={14 + i() * 24} size={20} />
            <rect
              class='tm-art-bar'
              classList={{ 'is-top': i() === 0 }}
              style={{ '--i': i() }}
              x='40'
              y={20 + i() * 24}
              width={deck.share}
              height='8'
              rx='2'
              stroke='none'
            />
            <Text x={148} y={28 + i() * 24} size={11} class={i() === 0 ? 'tm-art-ink' : undefined} anchor='end'>
              {deck.rate}
            </Text>
          </>
        )}
      </For>
    </Canvas>
  );
}

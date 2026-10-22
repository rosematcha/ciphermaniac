/**
 * Data behind /style.
 *
 * Two catalogues live here. TOKEN_GROUPS names every custom property the design
 * system publishes — the page reads their *computed* values off the live document
 * rather than repeating them, so the guide can never quietly disagree with
 * tokens.css. RULINGS is the drift ledger: every place the codebase currently
 * does one thing two ways, and which way is correct going forward.
 *
 * When a ruling gets applied everywhere, delete its entry. An empty ledger means
 * the system and the code agree.
 */

export interface TokenSpec {
  name: string;
  note?: string;
}

export type TokenKind = 'color' | 'shape' | 'space' | 'motion' | 'value';

export interface TokenGroup {
  title: string;
  kind: TokenKind;
  note?: string;
  tokens: TokenSpec[];
}

export const TOKEN_GROUPS: TokenGroup[] = [
  {
    title: 'Surfaces',
    kind: 'color',
    note: 'One cool grey: a grey page, white surfaces above it, and a recessed tier.',
    tokens: [
      { name: '--bg', note: 'Page' },
      { name: '--surface', note: 'Panels, rows, controls' },
      { name: '--surface-2', note: 'Recessed: table headers, tracks' },
      { name: '--zebra', note: 'Every other table row' },
      { name: '--row-hover', note: 'The row under the pointer' }
    ]
  },
  {
    title: 'Ink',
    kind: 'color',
    tokens: [
      { name: '--fg', note: 'Body text' },
      { name: '--muted', note: 'Secondary text, captions' },
      { name: '--border', note: 'Structural 1px border' },
      { name: '--rule', note: 'Hairline rule' }
    ]
  },
  {
    title: 'Accent',
    kind: 'color',
    note: 'Marigold, held to roughly a tenth of any screen. --accent fills, edges and marks state; --accent-ink is the same hue walked down to 4.5:1 for anything set as words; --accent-fill is the bright marigold under text. In dark mode accent and ink are the same colour.',
    tokens: [
      { name: '--accent', note: 'Fills, edges, bars, active state' },
      { name: '--accent-hover' },
      { name: '--accent-ink', note: 'Any accent set as words' },
      { name: '--accent-ink-hover' },
      { name: '--accent-fill', note: 'Under text: the primary button, a pressed chip' },
      { name: '--accent-fg', note: 'Text on an accent fill' }
    ]
  },
  {
    title: 'Sentiment',
    kind: 'color',
    note: 'Apple hues held to 4.5:1 on every ground in both modes. Never the only carrier of meaning — pair with a glyph or a number. A warning is dark amber text, never yellow words.',
    tokens: [{ name: '--positive' }, { name: '--negative' }, { name: '--warning' }]
  },
  {
    title: 'Chart series',
    kind: 'color',
    note: 'Apple system colours at full strength, decoupled from the accent so a series never reads as an active state. Lines draw at 2.5px and the legend singles a series out, because the light-mode green, orange and teal sit under 3:1 on white.',
    tokens: [
      { name: '--chart-1' },
      { name: '--chart-2' },
      { name: '--chart-3' },
      { name: '--chart-4' },
      { name: '--chart-5' },
      { name: '--chart-6' },
      { name: '--chart-7' },
      { name: '--chart-8' }
    ]
  },
  {
    title: 'Radius',
    kind: 'shape',
    tokens: [
      { name: '--radius-sm', note: 'Controls: buttons, fields, chips, badges' },
      { name: '--radius-md', note: 'Panels, tables, menus, sheets' },
      { name: '--radius-lg', note: 'Printed card art only' },
      { name: '--radius-pill', note: 'Removable tokens only' }
    ]
  },
  {
    title: 'Type scale',
    kind: 'value',
    note: 'Dense: data at 13px, captions and column heads at 11px, prose at 15px. Inputs rise to 16px on phones.',
    tokens: [
      { name: '--text-3xs', note: 'Sort marks, chart ticks' },
      { name: '--text-2xs', note: 'Fine print' },
      { name: '--text-xs', note: 'Captions, column heads' },
      { name: '--text-sm', note: 'Secondary, meta' },
      { name: '--text-base', note: 'Data rows, dense body' },
      { name: '--text-body', note: 'Prose, h3' },
      { name: '--text-lg', note: 'h2' },
      { name: '--text-xl', note: 'Wordmark' },
      { name: '--text-2xl', note: 'KPI value' }
    ]
  },
  {
    title: 'Space',
    kind: 'space',
    tokens: [
      { name: '--space-1' },
      { name: '--space-2' },
      { name: '--space-3' },
      { name: '--space-4' },
      { name: '--space-5' },
      { name: '--space-6' },
      { name: '--section-gap', note: 'Between top-level sections' }
    ]
  },
  {
    title: 'Motion',
    kind: 'motion',
    note: 'Quick fades: three durations, two curves, no bounce, nothing moves position. Reduced motion turns it all off.',
    tokens: [
      { name: '--ms-fast', note: 'Colour, opacity, menus' },
      { name: '--ms-base', note: 'Theme change, transform' },
      { name: '--ms-slow', note: 'Entering sheets' },
      { name: '--ease-base' },
      { name: '--ease-spring', note: 'Settle without overshoot' },
      { name: '--press-scale' }
    ]
  },
  {
    title: 'Elevation',
    kind: 'value',
    note: 'One shadow, for floating layers only: menus, popovers, sheets, dialogs, the card preview. Nothing in the page flow casts one.',
    tokens: [{ name: '--shadow-float' }]
  },
  {
    title: 'Focus',
    kind: 'value',
    note: 'A 2px outline in the text colour with a 2px gap, so it shows on every surface and around a marigold button. Bordered fields draw an ink border and a 1px ring instead.',
    tokens: [{ name: '--focus-color' }, { name: '--focus-width' }, { name: '--focus-offset' }, { name: '--focus-ring' }]
  },
  {
    title: 'Density',
    kind: 'value',
    tokens: [
      { name: '--row-height', note: 'Data row' },
      { name: '--border-width' },
      { name: '--topnav-h', note: 'Sticky-header offset; grows on phones' }
    ]
  }
];

export interface Ruling {
  /** The element or concern the ruling covers. */
  element: string;
  /** The one correct form. */
  ruling: string;
}

/** The design language as agreed on 2026-10-17, shared with events.ciphermaniac.com. */
export const RULINGS: Ruling[] = [
  {
    element: 'One system, two sites',
    ruling:
      'Tokens, base styles, primitives and the shared components come from @ciphermaniac/design, pinned by tag. Anything both sites draw belongs there; a site keeps only its own structure and pages.'
  },
  {
    element: 'Capitals',
    ruling:
      'None. Labels, captions and column heads are set in sentence case and take their rank from weight and size. The drift check fails any uppercase transform.'
  },
  {
    element: 'Grouping',
    ruling:
      'A drawn 1px edge for data and controls, the stat strip included; prose and summaries sit open between rules. An edged box never sits inside another.'
  },
  {
    element: 'Shape',
    ruling: '6px for controls, 10px for panels, 14px for printed card art and nothing else.'
  },
  {
    element: 'Shadow',
    ruling: 'One, --shadow-float, on floating layers only.'
  },
  {
    element: 'Buttons',
    ruling:
      'Three tiers: filled marigold for the one action that matters, bordered as the default, plain for low-stakes and row actions. Row actions stay quieter than the data they act on.'
  },
  {
    element: 'Tables',
    ruling: 'Zebra rows with a hover tint and a header band, no hairlines between rows, sticky heads under the bar.'
  },
  {
    element: 'Tabs and switches',
    ruling: 'Tabs for sections, underlined in ink; the segmented control, a radio group, for view modes.'
  },
  {
    element: 'Forms',
    ruling:
      'Labels beside fields on desktop and above them on phones, each field as wide as its answer, the error under the field.'
  },
  {
    element: 'Errors and loading',
    ruling:
      'Not-found and failure pages use the error state: a large pale code, a heading, one line, the ways on, no box. Loading reserves the real size with a still skeleton.'
  },
  {
    element: 'Icons',
    ruling: 'The package Icon set only: a 24px grid, 1.5px stroke, round caps, drawn at 16 or 20px.'
  },
  {
    element: 'Access',
    ruling:
      'Every text colour clears 4.5:1 in both modes, links in running text are underlined, phone inputs are 16px and taps 44px, and every page opens with one level-one heading.'
  }
];

/** Sanctioned departures. These look like violations and are not. */
export const EXCEPTIONS: { what: string; why: string }[] = [
  {
    what: 'social-graphics.css hardcodes the full palette',
    why: 'It renders an export canvas at fixed scale. The graphic must look identical whatever mode the browser is in, so it cannot read live tokens.'
  },
  {
    what: 'label-maker.css draws on true #fff with true #000',
    why: 'The label preview is physical thermal ink on physical stock, not UI. It stays white in dark mode.'
  },
  {
    what: 'The card tile scrim is a gradient',
    why: 'It buys legibility for the histogram and usage figure printed over card art. A flat fill would hide the art.'
  },
  {
    what: 'The fanned archetype thumbnail casts a shadow in the page',
    why: 'It reads as physical depth on a fan of real cards, which is the point of the fan.'
  },
  {
    what: 'The error page code is pale',
    why: 'It is decoration, drawn by CSS and hidden from assistive tech; the heading under it carries the message.'
  }
];

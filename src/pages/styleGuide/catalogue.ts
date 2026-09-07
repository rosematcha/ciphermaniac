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

export type TokenKind = 'color' | 'shape' | 'space' | 'shadow' | 'motion' | 'value';

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
    note: 'Three tiers of warm paper. Nothing is ever pure white or pure black, in either mode.',
    tokens: [
      { name: '--bg', note: 'Page' },
      { name: '--surface', note: 'Panels, rows, controls' },
      { name: '--surface-2', note: 'Recessed: table headers, tracks, hover' }
    ]
  },
  {
    title: 'Ink',
    kind: 'color',
    tokens: [
      { name: '--fg', note: 'Body text' },
      { name: '--muted', note: 'Secondary text, labels' },
      { name: '--border', note: 'Structural 1px border' },
      { name: '--rule', note: 'Hairline between data rows' }
    ]
  },
  {
    title: 'Accent',
    kind: 'color',
    note: 'Burnt orange, held to roughly 10% of any screen. Links, meaningful fills, active state.',
    tokens: [{ name: '--accent' }, { name: '--accent-hover' }, { name: '--accent-fg', note: 'Text on an accent fill' }]
  },
  {
    title: 'Sentiment',
    kind: 'color',
    note: 'Never the only carrier of meaning — pair with a glyph or a number.',
    tokens: [{ name: '--positive' }, { name: '--negative' }]
  },
  {
    title: 'Chart series',
    kind: 'color',
    note: 'Deliberately decoupled from the accent so a series colour never reads as an active state.',
    tokens: [{ name: '--chart-1' }, { name: '--chart-2' }, { name: '--chart-3' }]
  },
  {
    title: 'Radius',
    kind: 'shape',
    tokens: [
      { name: '--radius-sm', note: 'Controls: buttons, fields, chips, badges' },
      { name: '--radius-md', note: 'Panels, tables, sheets' },
      { name: '--radius-lg', note: 'Printed card art only' },
      { name: '--radius-pill', note: 'Removable tokens only' }
    ]
  },
  {
    title: 'Type scale',
    kind: 'value',
    note: 'Nine steps. 14/16/17px are still in circulation and not yet on the scale — see the Type scale ruling below.',
    tokens: [
      { name: '--text-3xs', note: 'Sort marks, chart ticks' },
      { name: '--text-2xs', note: 'Table headers' },
      { name: '--text-xs', note: 'Micro-label' },
      { name: '--text-sm', note: 'Secondary, meta' },
      { name: '--text-base', note: 'Data rows, dense body' },
      { name: '--text-body', note: 'Page body, h3' },
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
    title: 'Elevation',
    kind: 'shadow',
    note: 'A flat offset in ink — no blur, ever. Only --shadow-ink changes between modes; in dark it lands on the next surface tier instead of on ink.',
    tokens: [
      { name: '--shadow-1', note: 'At rest' },
      { name: '--shadow-2', note: 'Hover / raised' },
      { name: '--shadow-press', note: 'Active' }
    ]
  },
  {
    title: 'Motion',
    kind: 'motion',
    note: 'Three durations, two curves, no bounce. Never animate a layout property.',
    tokens: [
      { name: '--ms-fast', note: 'Colour, opacity' },
      { name: '--ms-base', note: 'Elevation, transform' },
      { name: '--ms-slow', note: 'Entering panels, sheets' },
      { name: '--ease-base' },
      { name: '--ease-spring', note: 'Settle without overshoot' },
      { name: '--press-scale' }
    ]
  },
  {
    title: 'Focus',
    kind: 'value',
    note: 'Outline is the default. The inset ring is only for bordered fields, which turn the outline off so the accent border and the halo read as one control.',
    tokens: [{ name: '--focus-width' }, { name: '--focus-offset' }, { name: '--focus-ring' }]
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

export type RulingStatus = 'settled' | 'open';

export interface Ruling {
  /** Short name of the thing that drifted. */
  element: string;
  /** What the codebase does today. */
  found: string;
  /** The one correct form going forward. */
  ruling: string;
  /** `open` means the call is still Reese's to make. */
  status: RulingStatus;
  /** Representative places to change, as file:line. Not exhaustive. */
  sites: string[];
}

export const RULINGS: Ruling[] = [
  {
    element: 'Eyebrow line',
    found:
      'The home page latest-event callout opens with .callout-eyebrow — a 10.5px all-caps label sitting above its heading, tracked at 0.14em. The house rules forbid eyebrow lines, and it is now the only uppercase label off the 0.08em recipe.',
    ruling:
      'Unresolved. The rule says remove it; the callout may need something in that slot to say what it is. Decide before the callout is touched again.',
    status: 'open',
    sites: ['components.css:1456', 'HomePage.tsx:516']
  },
  {
    element: 'Blurred shadow',
    found:
      'The fanned archetype thumbnail draws a soft blurred shadow under each card. It is the only blur left in the codebase; everything else is a flat offset.',
    ruling:
      'Unresolved. It reads as physical depth on a fan of real cards, which is arguably the point — but it is the lone exception to the signature.',
    status: 'open',
    sites: ['components.css:683 (.card-stack-slot)']
  },
  {
    element: 'Type scale',
    found:
      'Fifteen sizes were in circulation, including 10/10.5, 11/11.5 and 12/12.5/13.5 half-steps that were eyeballed rather than chosen. Thirty-six declarations have been collapsed onto a nine-step scale; 14px (8 uses), 16px (4) and 17px (2) are still off it.',
    ruling:
      'Nine steps, named in tokens.css. Whether 14/16/17 collapse into 13/15/18 is still open — unlike the half-steps, moving a full pixel on real body copy is visible, so it is a call to make rather than a cleanup to run.',
    status: 'open',
    sites: ['components.css (14px, 16px, 17px)', 'pages/survey.css:32', 'pages/in-loving-memory.css']
  },
  {
    element: 'Chip shape',
    found:
      'Two shape languages running side by side: square chips at --radius-sm (.chip, .au-chip, .badge, .callout-format-pill) and full pills (.mini-chip, .rf-chip, .fb-suggest-chip, .mu-lens-chip). Every literal is now a token, so the split is visible rather than buried in px.',
    ruling:
      'Square, at --radius-sm. STAMP is a hard-edged print system and a pill fights it. --radius-pill is reserved for a removable token — one that carries its own dismiss control, like .mu-lens-chip.',
    status: 'settled',
    sites: ['cards.css (.mini-chip)', 'components.css (.rf-chip, .fb-suggest-chip)']
  },
  {
    element: 'Button',
    found:
      'One canonical .btn with three variants and a shared disabled state, plus four parallel bordered controls that still re-derive the same chrome. .sg-btn is a line-for-line reimplementation of .btn-secondary and .btn-primary.',
    ruling:
      '.btn plus a variant is the only button. A page class may position or size a button; it may not restate its chrome.',
    status: 'settled',
    sites: [
      'social-graphics.css (.sg-btn)',
      'components.css (.fb-bar-btn)',
      'cards.css (.filters-btn)',
      'trends.css (.trend-add)',
      'in-loving-memory.css (.ilm-back)'
    ]
  },
  {
    element: 'Progress bar',
    found:
      'Six implementations, at 4 / 8 / 8 / 9 / 12 / 12px tall with four different radii. Only one carries a border.',
    ruling:
      '8px tall, --surface-2 track, --accent fill, --radius-sm, no border. The matchup deviation gauge is a different component and keeps its rule border and centre baseline.',
    status: 'settled',
    sites: [
      'components.css (.fb-bar-track, 4px)',
      'cards.css (.au-dist-bar, 9px)',
      'survey.css (.results .bar-track, 12px, pill, bordered)'
    ]
  },
  {
    element: 'Field chrome',
    found: 'Radius is now uniform, but .search still sits on --radius-md where every other field uses --radius-sm.',
    ruling:
      'A field on the page background uses --surface; a field inset inside a panel uses --bg, so it reads as a well rather than a second panel. --radius-sm either way.',
    status: 'settled',
    sites: ['components.css (.search)', 'in-loving-memory.css (.ilm-sort select — --bg, but not inside a panel)']
  },
  {
    element: 'Page heading',
    found:
      'Fourteen pages open with .hero and an h1. Six of the busiest routes — cards, archetypes, players, trends, home, survey results — have no h1 at all and open straight into a section.',
    ruling:
      'Every route opens with .hero: an h1 naming the page, then one .hero-meta line. This is the page title for assistive tech, not decoration. Needs copy for six titles before it can be applied.',
    status: 'settled',
    sites: [
      'CardsIndexPage.tsx',
      'ArchetypesIndexPage.tsx',
      'PlayersPage.tsx',
      'TrendsPage.tsx',
      'HomePage.tsx',
      'SurveyResultsPage.tsx'
    ]
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
    what: 'The skeleton shimmer is a gradient',
    why: 'It is the animation, not a fill.'
  },
  {
    what: 'Table headers are 10.5px, not the 11px micro-label',
    why: 'Data tables run denser than the rest of the system and the half pixel buys a column.'
  }
];

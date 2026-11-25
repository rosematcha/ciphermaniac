/**
 * The deck graphics' canvases: Day 2 conversion bars and the top-eight
 * matchup grid. They share the card graphic's head and footer.
 * @module src/pages/socialGraphics/DeckCanvases
 */

import { createSignal, For, type JSX, Match, Show, Switch } from 'solid-js';
import { deckIcons } from '../../lib/deckIcons';
import type { DeckData } from './deckData';
import type { DeckConversion, MatchupGrid } from './decks';
import type { DeckMode } from './model';
import { fitText } from './fitText';

/** Sprites draw at this multiple of their native pixel size, the same for every deck. */
const SPRITE_SCALE = 1.5;

/** Conversion bars run from zero to the next multiple of this above the highest rate. */
const BAR_STEP = 5;

export interface CanvasHeadProps {
  tournamentLabel: string;
  deckTotal: number;
}

/** The dark band every graphic opens with. */
export function CanvasHead(props: CanvasHeadProps) {
  return (
    <div class='sg-head'>
      <div class='sg-mark'>
        <img src='/logo.svg' alt='' width='24' height='28' />
        Ciphermaniac
      </div>
      <div class='sg-tournament'>
        <strong>{props.tournamentLabel}</strong>
      </div>
      <div class='sg-meta'>
        <strong>{props.deckTotal.toLocaleString()} decks</strong>
      </div>
    </div>
  );
}

interface DeckFrameProps extends CanvasHeadProps {
  theme: string;
  lead: string;
  accent: string;
  children: JSX.Element;
  /** Footer text before the site name; the footer is the site name alone without it. */
  note?: JSX.Element;
}

function DeckFrame(props: DeckFrameProps) {
  return (
    <div id='sg-canvas' class='sg-canvas' data-mode={props.theme}>
      <CanvasHead tournamentLabel={props.tournamentLabel} deckTotal={props.deckTotal} />
      <h1 class='sg-title'>
        {props.lead} <span class='accent'>{props.accent}</span>
      </h1>
      {props.children}
      <div class='sg-foot' classList={{ 'sg-foot-end': !props.note }}>
        <Show when={props.note}>
          <span>{props.note}</span>
        </Show>
        <span class='src'>ciphermaniac.com</span>
      </div>
    </div>
  );
}

/**
 * A deck's sprites at their native proportions, centered in a fixed slot so
 * rows line up. Served same-origin so the export can read them back.
 */
function DeckSprites(props: { label: string; class: string }) {
  return (
    <span class={`sg-sprites ${props.class}`}>
      <For each={deckIcons({ label: props.label }).slice(0, 2)}>{slug => <Sprite slug={slug} />}</For>
    </span>
  );
}

function Sprite(props: { slug: string }) {
  const [size, setSize] = createSignal<{ width: number; height: number }>();
  return (
    <img
      src={`/sprites/${props.slug}.png`}
      alt=''
      style={size() ? { width: `${size()!.width}px`, height: `${size()!.height}px` } : { visibility: 'hidden' }}
      onLoad={e =>
        setSize({
          width: e.currentTarget.naturalWidth * SPRITE_SCALE,
          height: e.currentTarget.naturalHeight * SPRITE_SCALE
        })
      }
    />
  );
}

/** Where a percentage falls along the bar track, as a fraction of it. */
function barScale(conversion: DeckConversion): (rate: number) => number {
  const top = Math.max(conversion.fieldRate, ...conversion.rows.map(r => r.rate));
  const end = Math.ceil(top / BAR_STEP) * BAR_STEP;
  return rate => rate / end;
}

export function ConversionCanvas(props: CanvasHeadProps & { theme: string; conversion: DeckConversion }) {
  const at = () => barScale(props.conversion);
  const fieldLabel = () => `${Math.round(props.conversion.fieldRate)}% field conversion`;
  return (
    <DeckFrame {...props} lead='DAY 2' accent='CONVERSION'>
      <div class='sg-conv' style={{ '--sg-field': at()(props.conversion.fieldRate) }}>
        <div class='sg-conv-field'>{fieldLabel()}</div>
        <For each={props.conversion.rows}>
          {row => (
            <div class='sg-conv-row' classList={{ beats: row.beatsField }}>
              <DeckSprites label={row.label} class='sg-conv-sprites' />
              <div class='sg-conv-name' ref={el => fitText(el, () => row.label, { max: 29, min: 20 })}>
                {row.label}
              </div>
              <div class='sg-conv-track'>
                <div class='sg-conv-bar' style={{ width: `${at()(row.rate) * 100}%` }} />
              </div>
              <div class='sg-conv-pct'>{Math.round(row.rate)}%</div>
            </div>
          )}
        </For>
      </div>
    </DeckFrame>
  );
}

/** Green for a winning matchup, red for a losing one, stronger the further from even. */
function cellTint(rate: number): string {
  const lean = (rate - 50) / 50;
  const alpha = Math.min(0.42, Math.abs(lean) * 1.4).toFixed(3);
  return `rgba(var(${lean >= 0 ? '--sg-pos-rgb' : '--sg-neg-rgb'}), ${alpha})`;
}

export function MatchupsCanvas(props: CanvasHeadProps & { theme: string; grid: MatchupGrid }) {
  const note = () => (
    <>
      <b>Row deck&apos;s win rate</b>
      <span> against the column deck, ties count as half, all rounds, {props.grid.fewestMatches}+ matches each</span>
    </>
  );
  return (
    <DeckFrame {...props} lead='MATCHUPS' accent='OF THE TOP EIGHT' note={note()}>
      <table class='sg-mx'>
        <colgroup>
          <col class='sg-mx-label' />
          <For each={props.grid.decks}>{() => <col />}</For>
        </colgroup>
        <thead>
          <tr>
            <th />
            <For each={props.grid.decks}>
              {deck => (
                <th>
                  <DeckSprites label={deck} class='sg-mx-sprites' />
                </th>
              )}
            </For>
          </tr>
        </thead>
        <tbody>
          <For each={props.grid.decks}>
            {(deck, i) => (
              <tr>
                <th>
                  <div class='sg-mx-deck'>
                    <DeckSprites label={deck} class='sg-mx-sprites' />
                    <span>{deck}</span>
                  </div>
                </th>
                <For each={props.grid.rates[i()]}>
                  {(rate, j) => (
                    <Show when={rate !== null} fallback={<td classList={{ self: i() === j() }} />}>
                      <td style={{ '--sg-tint': cellTint(rate!) }}>{Math.round(rate!)}%</td>
                    </Show>
                  )}
                </For>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </DeckFrame>
  );
}

/** Whichever deck graphic is chosen, once its data is in. */
export function DeckGraphic(props: CanvasHeadProps & { theme: string; mode: DeckMode; data: DeckData }) {
  return (
    <Switch>
      <Match when={props.mode === 'deck-conversion' && props.data.conversion()}>
        {c => <ConversionCanvas {...props} conversion={c()} />}
      </Match>
      <Match when={props.mode === 'matchups' && props.data.grid()}>
        {g => <MatchupsCanvas {...props} grid={g()} />}
      </Match>
    </Switch>
  );
}

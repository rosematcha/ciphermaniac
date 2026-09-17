import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { CardImage } from '../../components/CardImage';
import { Segmented } from '../../components/Segmented';
import { cheapestCost } from '../../../shared/packEv/cost';
import { openPack, possibleHits, preparePack, type Pull } from '../../../shared/packEv/simulate';
import type { PackEvSetPayload, RipSize } from '../../../shared/packEv/types';
import { attention, callout, juice, kick, staggerDelay } from './juice';
import { createCount } from './tween';
import {
  artNumber,
  hitsToWarm,
  isChase,
  mergePulls,
  money,
  productImage,
  type PullStack,
  sortStacks,
  type StackSort
} from './model';
import { warmHits, whenShown } from './warm';

interface PackOpenerProps {
  payload: PackEvSetPayload;
}

/**
 * What the buttons open. Fixed pack counts rather than the set's own sealed
 * list, so every set rips the same way: a bundle is 6, a box 36, and a case is
 * six boxes whether or not the set was ever sold in one. A set whose packs are
 * really bought some other way names its own (`rips`). Each rip is charged the
 * cheapest way to buy that many packs, so six 151 singles price a bundle that
 * sells above them.
 */
const PRODUCTS: RipSize[] = [
  { label: 'pack', packs: 1 },
  { label: 'bundle', packs: 6 },
  { label: 'box', packs: 36 },
  { label: 'case', packs: 216 }
];

const SORTS: { value: Exclude<StackSort, 'count'>; label: string }[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'value', label: 'Value' }
];

interface OpenedState {
  packs: number;
  value: number;
  /** What the rips cost, or null once one of them couldn't be priced. */
  spent: number | null;
  /** Rips so far, so a stack knows which one touched it last. */
  rips: number;
  /** What the latest rip made or lost against its cost, or null when it couldn't be priced. */
  delta: RipDelta | null;
  hits: PullStack[];
  bulk: PullStack[];
}

interface RipDelta {
  amount: number;
}

const EMPTY: OpenedState = { packs: 0, value: 0, spent: 0, rips: 0, delta: null, hits: [], bulk: [] };

function signed(amount: number): string {
  return `${amount >= 0 ? '+' : '−'}${money(Math.abs(amount))}`;
}

/** A rip's delta: popped in on mount, and remounted each rip because each rip makes a new one. */
function Attention(props: { delta: RipDelta }) {
  let mark!: HTMLElement;
  onMount(() => attention(mark));
  return (
    <small class={`packev-delta ${props.delta.amount >= 0 ? 'is-up' : 'is-down'}`} ref={mark} aria-hidden='true'>
      {signed(props.delta.amount)}
    </small>
  );
}

interface StackTileProps {
  stack: PullStack;
  set: string;
  size: 'sm' | 'xs';
  caption: boolean;
  /** The rip in progress; a stack it created pops in, one it added to bumps. */
  rip: number;
  /** Place in the grid, which staggers the pops like a deal. */
  index: number;
}

/**
 * One stack of identical prints: the art, a ×N badge, and what one copy is
 * worth. Art is hotlinked from Limitless — a case puts hundreds of unplayed
 * prints on screen, and none of them should cost us storage or a Function call.
 */
function StackTile(props: StackTileProps) {
  const card = () => props.stack.pull.card;
  let figure!: HTMLElement;
  // Stacks are immutable, so the grid only mounts a tile when a rip touched it.
  onMount(() => {
    const big = props.size === 'sm';
    const delay = staggerDelay(props.index);
    juice(
      figure,
      { scale: big ? 0.11 : 0.08, rotation: kick(big ? 5 : 3), pop: props.stack.first === props.rip },
      delay
    );
    if (isChase(props.stack.pull)) {
      callout(figure, delay);
    }
  });
  return (
    <figure class='packev-tile' ref={figure}>
      <Show when={card()} fallback={<div class='packev-art packev-art-blank'>{props.stack.pull.outcome}</div>}>
        {found => (
          <Show
            when={!found().reprint}
            fallback={<img class='packev-art' src={productImage(found().id)} alt={found().name} loading='lazy' />}
          >
            <CardImage
              class='packev-art'
              set={props.set}
              number={artNumber(found().number)}
              size={props.size}
              alt={found().name}
              hotlink
            />
          </Show>
        )}
      </Show>
      <Show when={props.stack.count > 1}>
        <b class='packev-badge'>×{props.stack.count}</b>
      </Show>
      <Show when={props.caption}>
        <figcaption>
          <span>{card()?.name ?? props.stack.pull.outcome}</span>
          <span class='packev-price'>{money(props.stack.pull.value)}</span>
        </figcaption>
      </Show>
    </figure>
  );
}

function tally(opened: OpenedState, packs: number, cost: number | null, pulls: Pull[]): OpenedState {
  const rips = opened.rips + 1;
  const value = pulls.reduce((sum, pull) => sum + pull.value, 0);
  return {
    packs: opened.packs + packs,
    value: opened.value + value,
    delta: cost === null ? null : { amount: value - cost },
    spent: opened.spent === null || cost === null ? null : opened.spent + cost,
    rips,
    hits: mergePulls(
      opened.hits,
      pulls.filter(pull => pull.notable),
      rips
    ),
    bulk: mergePulls(
      opened.bulk,
      pulls.filter(pull => !pull.notable),
      rips
    )
  };
}

/**
 * The pack opener.
 *
 * EV is an average over a distribution almost nobody lands on: the money in a
 * modern set sits in a handful of cards, so the median rip is well under the
 * mean and the mean is carried by boxes you will not open. Sampling it is the
 * only honest way to show that, so this opens real packs off the same slot
 * model the EV table averages, and keeps a running tally against their cost.
 * Hits land in a grid of stacked prints; everything at the bulk floor goes in a
 * drawer beneath it.
 */
export function PackOpener(props: PackOpenerProps) {
  // The whole payload, not a hand-picked subset of it: a field left out here
  // (special packs, once) silently opens a different pack than the table prices.
  const pack = createMemo(() => preparePack(props.payload));
  const [opened, setOpened] = createSignal<OpenedState>(EMPTY);
  const [sort, setSort] = createSignal<Exclude<StackSort, 'count'>>('value');
  const spent = () => opened().spent;
  const net = () => opened().value - (spent() ?? 0);
  const shownPacks = createCount(() => opened().packs);
  const shownValue = createCount(() => opened().value);
  const shownSpent = createCount(() => spent() ?? 0);
  const shownNet = createCount(net);
  const hits = createMemo(() => sortStacks(opened().hits, sort()));
  const bulk = createMemo(() => sortStacks(opened().bulk, 'count'));
  const bulkCards = createMemo(() => opened().bulk.reduce((sum, entry) => sum + entry.count, 0));

  // Hit art is warmed once the opener is on screen, so a reader who stops at
  // the EV table never downloads it.
  let root!: HTMLDivElement;
  const [shown, setShown] = createSignal(false);
  onMount(() => onCleanup(whenShown(root, () => setShown(true))));
  createEffect(() => {
    if (shown()) {
      onCleanup(warmHits(props.payload.code, hitsToWarm(possibleHits(pack()))));
    }
  });

  function rip(packs: number) {
    const prepared = pack();
    const pulls: Pull[] = [];
    for (let index = 0; index < packs; index += 1) {
      pulls.push(...openPack(prepared, Math.random));
    }
    const cost = cheapestCost(props.payload.sealed, packs);
    setOpened(current => tally(current, packs, cost, pulls));
  }

  return (
    <div class='packev-opener' ref={root}>
      <div class='packev-row'>
        <For each={props.payload.rips ?? PRODUCTS}>
          {product => (
            <button type='button' class='btn btn-secondary' onClick={() => rip(product.packs)}>
              Open a {product.label}
            </button>
          )}
        </For>
        <button type='button' class='btn btn-ghost' onClick={() => setOpened(EMPTY)} disabled={opened().packs === 0}>
          Clear
        </button>
      </div>

      <Show when={opened().packs > 0}>
        <dl class='packev-band'>
          <div class='packev-stat'>
            <dd>{Math.round(shownPacks())}</dd>
            <dt>Packs opened</dt>
          </div>
          <div class='packev-stat'>
            <dd>{money(shownValue())}</dd>
            <dt>Pulled</dt>
          </div>
          <Show when={spent() !== null}>
            <div class='packev-stat'>
              <dd>{money(shownSpent())}</dd>
              <dt>Spent</dt>
            </div>
            <div class='packev-stat'>
              <dd class={net() >= 0 ? 'is-up' : 'is-down'}>{signed(shownNet())}</dd>
              <dt>
                Against cost
                <Show when={opened().delta} keyed>
                  {delta => <Attention delta={delta} />}
                </Show>
              </dt>
            </div>
          </Show>
        </dl>

        <Show when={hits().length > 0}>
          <div class='packev-row'>
            <Segmented options={SORTS} selected={sort()} onSelect={setSort} ariaLabel='Sort pulls' />
          </div>
          <div class='packev-grid'>
            <For each={hits()}>
              {(entry, index) => (
                <StackTile
                  stack={entry}
                  set={props.payload.code}
                  size='sm'
                  caption
                  rip={opened().rips}
                  index={index()}
                />
              )}
            </For>
          </div>
        </Show>

        <details class='packev-bulk'>
          <summary>
            Bulk pile
            <span class='packev-aside'>
              {bulkCards()} cards · {bulk().length} different
            </span>
          </summary>
          <div class='packev-grid is-tiny'>
            <For each={bulk()}>
              {(entry, index) => (
                <StackTile
                  stack={entry}
                  set={props.payload.code}
                  size='xs'
                  caption={false}
                  rip={opened().rips}
                  index={index()}
                />
              )}
            </For>
          </div>
        </details>
      </Show>
    </div>
  );
}

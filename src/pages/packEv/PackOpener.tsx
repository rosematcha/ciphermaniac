import { createMemo, createSignal, For, Show } from 'solid-js';
import { CardImage } from '../../components/CardImage';
import { Segmented } from '../../components/Segmented';
import { cheapestCost } from '../../../shared/packEv/cost';
import { openPack, preparePack, type Pull } from '../../../shared/packEv/simulate';
import type { PackEvSetPayload } from '../../../shared/packEv/types';
import { artNumber, mergePulls, money, type PullStack, sortStacks, type StackSort } from './model';

interface PackOpenerProps {
  payload: PackEvSetPayload;
}

/**
 * What the buttons open. Fixed pack counts rather than the set's own sealed
 * list, so every set rips the same way: a bundle is 6, a box 36, and a case is
 * six boxes whether or not the set was ever sold in one. Each rip is charged
 * the cheapest way to buy that many packs, so six 151 singles price a bundle
 * that sells above them.
 */
const PRODUCTS = [
  { label: 'pack', packs: 1 },
  { label: 'bundle', packs: 6 },
  { label: 'box', packs: 36 },
  { label: 'case', packs: 216 }
] as const;

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
  hits: PullStack[];
  bulk: PullStack[];
}

const EMPTY: OpenedState = { packs: 0, value: 0, spent: 0, rips: 0, hits: [], bulk: [] };

interface StackTileProps {
  stack: PullStack;
  set: string;
  size: 'sm' | 'xs';
  caption: boolean;
}

/**
 * One stack of identical prints: the art, a ×N badge, and what one copy is
 * worth. Art is hotlinked from Limitless — a case puts hundreds of unplayed
 * prints on screen, and none of them should cost us storage or a Function call.
 */
function StackTile(props: StackTileProps) {
  const card = () => props.stack.pull.card;
  return (
    <figure class='packev-tile'>
      <Show when={card()} fallback={<div class='packev-art packev-art-blank'>{props.stack.pull.outcome}</div>}>
        {found => (
          <CardImage
            class='packev-art'
            set={props.set}
            number={artNumber(found().number)}
            size={props.size}
            alt={found().name}
            hotlink
          />
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
  return {
    packs: opened.packs + packs,
    value: opened.value + pulls.reduce((sum, pull) => sum + pull.value, 0),
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
  const hits = createMemo(() => sortStacks(opened().hits, sort()));
  const bulk = createMemo(() => sortStacks(opened().bulk, 'count'));
  const bulkCards = createMemo(() => opened().bulk.reduce((sum, entry) => sum + entry.count, 0));

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
    <div class='packev-opener'>
      <div class='packev-row'>
        <For each={PRODUCTS}>
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
            <dd>{opened().packs}</dd>
            <dt>Packs opened</dt>
          </div>
          <div class='packev-stat'>
            <dd>{money(opened().value)}</dd>
            <dt>Pulled</dt>
          </div>
          <Show when={spent() !== null}>
            <div class='packev-stat'>
              <dd>{money(spent() ?? 0)}</dd>
              <dt>Spent</dt>
            </div>
            <div class='packev-stat'>
              <dd class={net() >= 0 ? 'is-up' : 'is-down'}>
                {net() >= 0 ? '+' : '−'}
                {money(Math.abs(net()))}
              </dd>
              <dt>Against cost</dt>
            </div>
          </Show>
        </dl>

        <Show when={hits().length > 0}>
          <div class='packev-row'>
            <Segmented options={SORTS} selected={sort()} onSelect={setSort} ariaLabel='Sort pulls' />
          </div>
          <div class='packev-grid'>
            <For each={hits()}>{entry => <StackTile stack={entry} set={props.payload.code} size='sm' caption />}</For>
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
              {entry => <StackTile stack={entry} set={props.payload.code} size='xs' caption={false} />}
            </For>
          </div>
        </details>
      </Show>
    </div>
  );
}

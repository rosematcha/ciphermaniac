import { createMemo, createSignal, For, Show } from 'solid-js';
import { openPack, preparePack, type Pull } from '../../../shared/packEv/simulate';
import type { PackEvSetPayload } from '../../../shared/packEv/types';
import { money } from './model';

interface PackOpenerProps {
  payload: PackEvSetPayload;
  /** What the packs would have cost, per pack. Null when nothing is priced. */
  costPerPack: number | null;
}

/**
 * What the buttons open. Fixed pack counts rather than the set's own sealed
 * list, so every set rips the same way: a bundle is 6, a box 36, and a case is
 * six boxes whether or not the set was ever sold in one.
 */
const PRODUCTS = [
  { label: 'pack', packs: 1 },
  { label: 'bundle', packs: 6 },
  { label: 'box', packs: 36 },
  { label: 'case', packs: 216 }
] as const;

interface OpenedState {
  packs: number;
  value: number;
  /** Everything above the bulk floor, newest first. */
  hits: Pull[];
}

const EMPTY: OpenedState = { packs: 0, value: 0, hits: [] };

/**
 * The pack opener.
 *
 * EV is an average over a distribution almost nobody lands on: the money in a
 * modern set sits in a handful of cards, so the median rip is well under the
 * mean and the mean is carried by boxes you will not open. Sampling it is the
 * only honest way to show that, so this opens real packs off the same slot
 * model the EV table averages, and keeps a running tally against their cost.
 */
export function PackOpener(props: PackOpenerProps) {
  // The whole payload, not a hand-picked subset of it: a field left out here
  // (special packs, once) silently opens a different pack than the table prices.
  const pack = createMemo(() => preparePack(props.payload));
  const [opened, setOpened] = createSignal<OpenedState>(EMPTY);
  const [last, setLast] = createSignal<Pull[]>([]);
  const spent = () => (props.costPerPack === null ? null : opened().packs * props.costPerPack);

  function rip(packs: number) {
    const prepared = pack();
    let value = 0;
    const hits: Pull[] = [];
    let latest: Pull[] = [];
    for (let index = 0; index < packs; index += 1) {
      latest = openPack(prepared, Math.random);
      for (const pull of latest) {
        value += pull.value;
        if (pull.notable) {
          hits.push(pull);
        }
      }
    }
    setLast(latest);
    setOpened(current => ({
      packs: current.packs + packs,
      value: current.value + value,
      hits: [...hits.reverse(), ...current.hits].slice(0, 60)
    }));
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
        <button
          type='button'
          class='btn btn-ghost'
          onClick={() => {
            setOpened(EMPTY);
            setLast([]);
          }}
          disabled={opened().packs === 0}
        >
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
              <dd class={opened().value >= (spent() ?? 0) ? 'is-up' : 'is-down'}>
                {opened().value >= (spent() ?? 0) ? '+' : '−'}
                {money(Math.abs(opened().value - (spent() ?? 0)))}
              </dd>
              <dt>Against cost</dt>
            </div>
          </Show>
        </dl>
      </Show>

      <Show when={last().length > 0}>
        <div class='packev-row packev-lastpack'>
          <For each={last()}>
            {pull => (
              <span classList={{ 'is-hit': pull.notable }}>
                {pull.card ? pull.card.name : pull.outcome}
                <Show when={pull.notable}> · {money(pull.value)}</Show>
              </span>
            )}
          </For>
        </div>
      </Show>

      <Show when={opened().hits.length > 0}>
        <table class='data'>
          <thead>
            <tr>
              <th>Hit</th>
              <th>Rarity</th>
              <th class='num'>Market</th>
            </tr>
          </thead>
          <tbody>
            <For each={opened().hits}>
              {hit => (
                <tr>
                  <td class='cardname'>
                    {hit.card?.name}
                    <span class='packev-aside'>{hit.card?.number}</span>
                  </td>
                  <td class='muted-cell'>{hit.outcome}</td>
                  <td class='num'>{money(hit.value)}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </Show>
    </div>
  );
}

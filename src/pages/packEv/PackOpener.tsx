import { createMemo, createSignal, For, Show } from 'solid-js';
import { openPack, preparePack, type Pull, simulateSpread } from '../../../shared/packEv/simulate';
import type { PackEvSetPayload, SealedProduct } from '../../../shared/packEv/types';
import { money, shareLabel } from './model';

interface PackOpenerProps {
  payload: PackEvSetPayload;
  /** What the packs would have cost, per pack. Null when nothing is priced. */
  costPerPack: number | null;
  /** The product the box simulation opens. */
  primary: SealedProduct | null;
}

/** Runs behind a button, so a slow phone never pays for it on load. */
const SPREAD_RUNS = 4000;

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
 * model the EV table averages, and reports the spread over thousands of boxes
 * next to the one you just opened.
 */
export function PackOpener(props: PackOpenerProps) {
  // The whole payload, not a hand-picked subset of it: a field left out here
  // (special packs, once) silently opens a different pack than the table prices.
  const pack = createMemo(() => preparePack(props.payload));
  const [opened, setOpened] = createSignal<OpenedState>(EMPTY);
  const [last, setLast] = createSignal<Pull[]>([]);
  const [spread, setSpread] = createSignal<ReturnType<typeof simulateSpread> | null>(null);

  const boxPacks = () => props.primary?.packs ?? 36;
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

  function runSpread() {
    const cost = props.costPerPack === null ? null : props.costPerPack * boxPacks();
    setSpread(simulateSpread(pack(), { packs: boxPacks(), runs: SPREAD_RUNS, cost }, Math.random));
  }

  return (
    <div class='packev-opener'>
      <div class='packev-row'>
        <button type='button' class='btn btn-secondary' onClick={() => rip(1)}>
          Open a pack
        </button>
        <button type='button' class='btn btn-secondary' onClick={() => rip(boxPacks())}>
          Open {boxPacks()} packs
        </button>
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

      <div class='packev-row'>
        <button type='button' class='btn btn-secondary' onClick={runSpread}>
          Simulate {SPREAD_RUNS.toLocaleString('en-US')} × {boxPacks()} packs
        </button>
        <Show when={spread()}>
          {result => (
            <span>
              Median {money(result().median)} · middle 80% {money(result().low)} to {money(result().high)} · mean{' '}
              {money(result().mean)}
              <Show when={result().beatsCost !== null}>
                {' '}
                · beat the {props.primary?.label.toLowerCase() ?? 'sealed'} price {shareLabel(result().beatsCost ?? 0)}{' '}
                of the time
              </Show>
            </span>
          )}
        </Show>
      </div>
    </div>
  );
}

import { createMemo, For, Show } from 'solid-js';
import { Section } from '../../components/Section';
import { topCardContributions } from '../../../shared/packEv/ev';
import type { PackEvSetPayload } from '../../../shared/packEv/types';
import { PackOpener } from './PackOpener';
import { money, oddsLabel, primaryProduct, returnPercent, sealedRows, slotRows } from './model';

/** Cards worth naming. Past a dozen the tail is all sub-dollar contributions. */
const TOP_CARDS = 12;

interface SetDetailProps {
  payload: PackEvSetPayload;
}

/**
 * One set: what a pack is worth, where that value sits, and what the sealed
 * product asks for it.
 *
 * Every figure on this screen comes from the published payload rather than
 * being recomputed against different assumptions — the EV table, the card
 * list and the opener all read the same slot model and the same prices.
 */
export function SetDetail(props: SetDetailProps) {
  const primary = createMemo(() => primaryProduct(props.payload));
  const costPerPack = createMemo(() => {
    const product = primary();
    return product?.price ? product.price / product.packs : null;
  });
  const rows = createMemo(() => slotRows(props.payload.ev.slots));
  const sealed = createMemo(() => sealedRows(props.payload));
  const cards = createMemo(() => topCardContributions(props.payload, TOP_CARDS));

  return (
    <>
      <dl class='packev-band'>
        <div class='packev-stat is-lead'>
          <dd>{money(props.payload.ev.perPack)}</dd>
          <dt>A pack, opened</dt>
        </div>
        <Show when={costPerPack()}>
          {cost => (
            <div class='packev-stat'>
              <dd>{money(cost())}</dd>
              <dt>A pack, sealed</dt>
            </div>
          )}
        </Show>
        <Show when={primary()?.price}>
          <div class='packev-stat'>
            <dd>{money(props.payload.ev.perPack * (primary()?.packs ?? 1))}</dd>
            <dt>
              {primary()?.label}, {primary()?.packs} packs
            </dt>
          </div>
        </Show>
        <Show when={returnPercent(props.payload.ev.perPack, costPerPack())}>
          {percent => (
            <div class='packev-stat'>
              <dd class={percent() < 100 ? 'is-down' : 'is-up'}>{percent()}%</dd>
              <dt>Of what you paid</dt>
            </div>
          )}
        </Show>
      </dl>

      <Section title='Where the value sits'>
        <div class='table-wrap'>
          <table class='data packev-slots'>
            <thead>
              <tr>
                <th>Slot</th>
                <th>Outcome</th>
                <th class='num'>Odds</th>
                <th class='num'>Average</th>
                <th class='num'>Per pack</th>
              </tr>
            </thead>
            <tbody>
              <For each={rows()}>
                {row => (
                  <tr classList={{ 'is-slot-start': row.slot !== null }}>
                    <td>
                      <Show when={row.slot}>
                        {row.slot}
                        <Show when={(row.count ?? 1) > 1}>
                          <span class='packev-aside'>×{row.count}</span>
                        </Show>
                      </Show>
                    </td>
                    <td>{row.outcome}</td>
                    <td class='num muted-cell'>{oddsLabel(row.chance)}</td>
                    <td class='num'>{money(row.averageValue)}</td>
                    <td class='num'>{money(row.contribution)}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Section>

      <Section title='The cards carrying it'>
        <div class='table-wrap'>
          <table class='data'>
            <thead>
              <tr>
                <th>Card</th>
                <th>Rarity</th>
                <th class='num'>Odds</th>
                <th class='num'>Market</th>
                <th class='num'>Per pack</th>
              </tr>
            </thead>
            <tbody>
              <For each={cards()}>
                {row => (
                  <tr>
                    <td class='cardname'>
                      {row.card.name}
                      <span class='packev-aside'>{row.card.number}</span>
                    </td>
                    <td class='muted-cell'>{row.card.rarity}</td>
                    <td class='num muted-cell'>{oddsLabel(row.chance)}</td>
                    <td class='num'>{money(row.value)}</td>
                    <td class='num'>{money(row.contribution)}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Section>

      <Section title='What it costs sealed'>
        <div class='table-wrap'>
          <table class='data'>
            <thead>
              <tr>
                <th>Product</th>
                <th class='num'>Packs</th>
                <th class='num'>Price</th>
                <th class='num'>A pack</th>
                <th class='num'>Contents</th>
                <th class='num'>Return</th>
              </tr>
            </thead>
            <tbody>
              <For each={sealed()}>
                {row => (
                  <tr>
                    <td>
                      <a href={row.product.url} target='_blank' rel='noopener noreferrer'>
                        {row.product.label}
                      </a>
                    </td>
                    <td class='num muted-cell'>{row.product.packs}</td>
                    <td class='num'>{row.product.price === null ? '—' : money(row.product.price)}</td>
                    <td class='num'>{row.costPerPack === null ? '—' : money(row.costPerPack)}</td>
                    <td class='num'>{money(row.contentsValue)}</td>
                    <td class='num' classList={{ 'is-down': (row.returnPercent ?? 100) < 100 }}>
                      {row.returnPercent === null ? '—' : `${row.returnPercent}%`}
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Section>

      <Section title='Open some packs'>
        <PackOpener payload={props.payload} costPerPack={costPerPack()} primary={primary()} />
      </Section>
    </>
  );
}

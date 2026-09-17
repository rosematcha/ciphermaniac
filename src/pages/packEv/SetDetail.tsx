import { createMemo, For, Show } from 'solid-js';
import { Section } from '../../components/Section';
import { cheapestPerPack } from '../../../shared/packEv/cost';
import { topCardContributions } from '../../../shared/packEv/ev';
import type { PackEvSetPayload } from '../../../shared/packEv/types';
import { PackOpener } from './PackOpener';
import { lossPercent, money } from './model';

/** Cards worth naming. Past a dozen the tail is all sub-dollar contributions. */
const TOP_CARDS = 12;

interface SetDetailProps {
  payload: PackEvSetPayload;
}

/**
 * One set: what a pack costs sealed, what it is worth opened, the cards that
 * worth rests on, and an opener to rip it.
 *
 * Every figure on this screen comes from the published payload rather than
 * being recomputed against different assumptions — the band, the card list and
 * the opener all read the same slot model and the same prices.
 */
export function SetDetail(props: SetDetailProps) {
  const costPerPack = createMemo(() => cheapestPerPack(props.payload.sealed)?.costPerPack ?? null);
  const loss = createMemo(() => lossPercent(props.payload.ev.perPack, costPerPack()));
  const cards = createMemo(() => topCardContributions(props.payload, TOP_CARDS));

  return (
    <>
      <Section title={props.payload.name}>
        <dl class='packev-band'>
          <Show when={costPerPack()}>
            {cost => (
              <div class='packev-stat'>
                <dd>{money(cost())}</dd>
                <dt>Sealed market price</dt>
              </div>
            )}
          </Show>
          <div class='packev-stat is-lead'>
            <dd>{money(props.payload.ev.perPack)}</dd>
            <dt>Expected value</dt>
          </div>
          <Show when={loss() !== null}>
            <div class='packev-stat'>
              <dd class={(loss() ?? 0) > 0 ? 'is-down' : 'is-up'}>{loss()}%</dd>
              <dt>Expected loss</dt>
            </div>
          </Show>
        </dl>
      </Section>

      <Section title='Highest EV generators'>
        <div class='table-wrap'>
          <table class='data'>
            <thead>
              <tr>
                <th>Card</th>
                <th class='num'>Market</th>
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
                    <td class='num'>{money(row.value)}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Section>

      <Section title='Open some packs'>
        <PackOpener payload={props.payload} />
      </Section>
    </>
  );
}

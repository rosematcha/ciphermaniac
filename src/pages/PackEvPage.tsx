import { createMemo, createResource, For, Match, onMount, type Resource, Show, Switch } from 'solid-js';
import { useSearchParams } from '@solidjs/router';
import { EmptyState } from '../components/EmptyState';
import { Section } from '../components/Section';
import { Skeleton } from '../components/Skeleton';
import { fetchPackEvIndex, fetchPackEvSet } from '../lib/data/packEv';
import { resolved } from '../lib/resource';
import { SetDetail } from './packEv/SetDetail';
import { money, priceDate, rate, returnPercent } from './packEv/model';
import '../styles/pages/pack-ev.css';

/**
 * True once a read has settled without data: a transport failure, or a 404
 * (`fetchJsonOptional` resolves those to null). Either way the skeleton must
 * give way to a message rather than wait forever.
 */
function settledEmpty<T>(resource: Resource<T | null>): boolean {
  return resource.state === 'errored' || (resource.state === 'ready' && resource() === null);
}

/**
 * Pack EV (/tools/pack-ev).
 *
 * Answers one question per set: is a pack worth more opened or sealed? The
 * daily job publishes the card list, the market prices and the published pull
 * rates; this page puts the resulting per-pack value against what the sealed
 * product costs, and lets you rip packs against the same model.
 */
export function PackEvPage() {
  const [index] = createResource(fetchPackEvIndex);
  const [params, setParams] = useSearchParams<{ set?: string }>();

  onMount(() => {
    document.title = 'Pack EV — Ciphermaniac';
  });

  const sets = () => resolved(index)?.sets ?? [];
  const selected = createMemo(() => {
    const wanted = params.set?.toUpperCase();
    const rows = sets();
    return rows.find(row => row.code === wanted)?.code ?? rows[0]?.code ?? null;
  });
  const [payload] = createResource(selected, fetchPackEvSet);
  const detail = () => resolved(payload);

  return (
    <>
      <section class='hero'>
        <h1>Pack EV</h1>
        <div class='hero-meta'>
          <Show when={resolved(index)}>
            {loaded => <>Market prices from TCGplayer, {priceDate(loaded().generatedAt)}</>}
          </Show>
        </div>
      </section>

      <Show
        when={sets().length > 0}
        fallback={
          <Show
            when={index.state === 'ready' || index.state === 'errored'}
            fallback={<Skeleton width='100%' height='220px' />}
          >
            <EmptyState title='No pack data.' />
          </Show>
        }
      >
        <Section title='Sets'>
          <div class='table-wrap'>
            <table class='data packev-index'>
              <thead>
                <tr>
                  <th>Set</th>
                  <th class='num'>A pack, opened</th>
                  <th class='num'>A pack, sealed</th>
                  <th class='num'>Return</th>
                </tr>
              </thead>
              <tbody>
                <For each={sets()}>
                  {row => (
                    <tr
                      class='is-link'
                      classList={{ 'is-selected': row.code === selected() }}
                      aria-current={row.code === selected() ? 'true' : undefined}
                      tabIndex={0}
                      onClick={() => setParams({ set: row.code }, { replace: true })}
                      onKeyDown={event => {
                        if (event.key === 'Enter') {
                          setParams({ set: row.code }, { replace: true });
                        }
                      }}
                    >
                      <td>
                        <span class='cardname'>{row.name}</span>
                        <span class='packev-aside'>{row.primaryLabel}</span>
                      </td>
                      <td class='num'>{money(row.evPerPack)}</td>
                      <td class='num'>{row.costPerPack === null ? '—' : money(row.costPerPack)}</td>
                      <td
                        class='num'
                        classList={{ 'is-down': (returnPercent(row.evPerPack, row.costPerPack) ?? 100) < 100 }}
                      >
                        {returnPercent(row.evPerPack, row.costPerPack) === null
                          ? '—'
                          : `${returnPercent(row.evPerPack, row.costPerPack)}%`}
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </Section>

        <Switch fallback={<Skeleton width='100%' height='320px' />}>
          <Match when={settledEmpty(payload)}>
            <EmptyState title='No data for this set.' />
          </Match>
          <Match when={detail()}>
            {loaded => (
              <>
                <SetDetail payload={loaded()} />
                <section>
                  <ul class='packev-method'>
                    <li>
                      Pull rates:{' '}
                      <a href={loaded().source.url} target='_blank' rel='noopener noreferrer'>
                        {loaded().source.label}
                      </a>
                      , over {loaded().source.sampleSize.toLocaleString('en-US')} packs
                    </li>
                    <li>Prices: TCGplayer market, via TCGCSV</li>
                    <li>
                      Under {money(loaded().threshold)} a card counts as bulk: {rate(loaded().bulk.commonUncommon)}{' '}
                      common or uncommon, {rate(loaded().bulk.reverse)} reverse or rare,{' '}
                      {rate(loaded().bulk.doubleRare)} ex (
                      <a href={loaded().bulkSource.url} target='_blank' rel='noopener noreferrer'>
                        {loaded().bulkSource.label}
                      </a>
                      )
                    </li>
                    <li>Sealed products are counted as packs only — no promo, sleeves or dice</li>
                  </ul>
                </section>
              </>
            )}
          </Match>
        </Switch>
      </Show>
    </>
  );
}

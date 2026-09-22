import { For, Show } from 'solid-js';
import { A } from '@solidjs/router';
import { CardImage } from '../../components/CardImage';
import { formatShare, monthYear, type SetImpactRow } from '../../utils/setImpactRows';

const PANEL_CARDS = 10;

/** The selected set: its figures, its line across the majors, and its cards. */
export function SetPanel(props: { row: SetImpactRow }) {
  const rest = () => props.row.cards.slice(PANEL_CARDS);
  return (
    <div class='set-impact-detail'>
      <h2>
        {props.row.name} <span class='set-impact-code'>{props.row.code}</span>
      </h2>
      <p class='set-impact-span'>
        Legal {monthYear(props.row.legalFrom)} to {props.row.rotatesOn ? monthYear(props.row.rotatesOn) : '—'}
        {props.row.rotationPredicted ? '*' : ''}
      </p>
      <dl class='set-impact-figures'>
        <Figure label='Lifetime' value={props.row.lifetime?.toFixed(1) ?? '—'} />
        <Figure label='Per major' value={props.row.perMajor.toFixed(1)} />
        <Figure label='Staples' value={props.row.staples.toFixed(1)} />
        <Figure label='Seen' value={props.row.coverage === null ? '—' : `${Math.round(props.row.coverage * 100)}%`} />
      </dl>
      <Show when={props.row.series.length > 1}>
        <Spark values={props.row.series} />
        <div class='set-impact-axis'>
          <span>{props.row.seenFrom ? monthYear(props.row.seenFrom) : ''}</span>
          <span>{props.row.seenUntil ? monthYear(props.row.seenUntil) : ''}</span>
        </div>
      </Show>
      <ul class='set-impact-cards'>
        <For each={props.row.cards.slice(0, PANEL_CARDS)}>
          {card => <CardLine card={card} max={props.row.cards[0]?.share ?? 1} />}
        </For>
      </ul>
      <Show when={rest().length > 0}>
        <p class='set-impact-more'>
          {rest().length} more cards · {formatShare(rest().reduce((sum, card) => sum + card.share, 0))} of a deck
          combined
        </p>
      </Show>
    </div>
  );
}

function Figure(props: { label: string; value: string }) {
  return (
    <div>
      <dt>{props.label}</dt>
      <dd>{props.value}</dd>
    </div>
  );
}

function CardLine(props: { card: SetImpactRow['cards'][number]; max: number }) {
  return (
    <li>
      <A class='set-impact-card' href={`/cards/${props.card.set}/${props.card.number}`}>
        <span class='set-impact-card-art'>
          <CardImage set={props.card.set} number={props.card.number} size='xs' alt='' />
        </span>
        <span class='set-impact-card-name'>
          {props.card.name}
          <Show when={props.card.staple}>
            <span class='set-impact-tag'>staple</span>
          </Show>
        </span>
        <span class='set-impact-card-track'>
          <span
            classList={{ 'set-impact-card-fill': true, 'is-staple': props.card.staple }}
            style={{ width: `${props.max > 0 ? (props.card.share / props.max) * 100 : 0}%` }}
          />
        </span>
        <span class='set-impact-card-share'>{formatShare(props.card.share)}</span>
      </A>
    </li>
  );
}

const SPARK_W = 300;
const SPARK_H = 56;

/** The per-major figure across the majors the set was legal for. */
function Spark(props: { values: number[] }) {
  const points = () => {
    const max = Math.max(...props.values, 0.01);
    const last = Math.max(1, props.values.length - 1);
    return props.values
      .map(
        (value, i) => `${((i / last) * SPARK_W).toFixed(1)},${(SPARK_H - (value / max) * (SPARK_H - 2) - 1).toFixed(1)}`
      )
      .join(' ');
  };
  return (
    <svg class='set-impact-spark' viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} preserveAspectRatio='none' aria-hidden='true'>
      <polyline points={points()} />
    </svg>
  );
}

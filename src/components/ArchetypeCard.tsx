import { A } from '@solidjs/router';
import type { ArchetypeIndexEntry } from '../types';
import { Trend, type TrendDirection } from './Trend';
import { CardStack } from './CardImage';
import { formatPercent } from '../lib/format';

interface ArchetypeCardProps {
  entry: ArchetypeIndexEntry;
  rank?: number;
  trend?: { direction: TrendDirection; delta?: string };
}

/**
 * Archetype gallery card. Click → /archetypes/[slug].
 * Uses real card images via CardStack when the index gives us a thumbnails list;
 * otherwise falls back to the index's signature cards.
 */
export function ArchetypeCard(props: ArchetypeCardProps) {
  const slug = () => props.entry.name;

  const thumbnails = (): string[] => {
    const indexThumbs = props.entry.thumbnails;
    if (indexThumbs && indexThumbs.length > 0) {
      return indexThumbs;
    }
    // Fallback: use signatureCards (set/number pairs) as a substitute for thumbnails.
    const sig = props.entry.signatureCards ?? [];
    return sig
      .filter(s => s.set && s.number)
      .slice(0, 3)
      .map(s => `${s.set}/${s.number}`);
  };

  const share = () => formatPercent(props.entry.percent);

  const decks = () => {
    const n = props.entry.deckCount;
    if (n === null || n === undefined) {
      return null;
    }
    return n.toLocaleString();
  };

  return (
    <A class='arche' href={`/archetypes/${encodeURIComponent(slug())}`}>
      <div class='arche-thumb' aria-hidden='true'>
        <CardStack thumbnails={thumbnails()} size='xs' />
      </div>
      <div class='arche-name'>{props.entry.label || props.entry.name}</div>
      <div class='arche-stats'>
        <span class='arche-share'>{share()}</span>
        {decks() ? <span class='arche-wr'>{decks()} decks</span> : null}
        {props.trend ? <Trend direction={props.trend.direction} delta={props.trend.delta} /> : null}
      </div>
    </A>
  );
}

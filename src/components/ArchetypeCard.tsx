import { A } from '@solidjs/router';
import type { ArchetypeIndexEntry } from '../types';
import { Trend, type TrendDirection } from './Trend';
import { CardStack } from './CardImage';
import { formatPercent } from '../lib/format';

interface ArchetypeCardProps {
  entry: ArchetypeIndexEntry;
  /** Online-meta entry for the same archetype, used as an image fallback when
   * the event entry ships without thumbnails/signature cards. */
  online?: ArchetypeIndexEntry;
  rank?: number;
  trend?: { direction: TrendDirection; delta?: string };
}

function entryThumbnails(entry: ArchetypeIndexEntry | undefined): string[] {
  return entry?.thumbnails ?? [];
}

/**
 * Archetype gallery card. Click → /archetypes/[slug].
 * Uses real card images via CardStack from the index's thumbnails list, falling
 * back to the online entry's thumbnails for event views that ship without them.
 */
export function ArchetypeCard(props: ArchetypeCardProps) {
  const slug = () => props.entry.name;

  const thumbnails = (): string[] => {
    const own = entryThumbnails(props.entry);
    return own.length > 0 ? own : entryThumbnails(props.online);
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

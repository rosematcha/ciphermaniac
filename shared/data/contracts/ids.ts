import { parseCardUid } from '../cardIdentity';
import { type NormalizedEventKind, SCHEMA_VERSION } from './types';

function requireIdSegment(value: string | number, label: string): string {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new TypeError(`${label}: expected a finite number`);
  }
  const segment = typeof value === 'number' ? String(value) : value;
  if (typeof segment !== 'string' || segment.trim().length === 0) {
    throw new TypeError(`${label}: expected a non-empty string`);
  }
  if (segment.includes('|')) {
    throw new TypeError(`${label}: must not contain the reserved "|" delimiter`);
  }
  return segment;
}

export function eventId(kind: NormalizedEventKind, code: string): string {
  const prefix = kind === 'labs-event' ? 'labs' : 'online';
  return `${prefix}:${requireIdSegment(code, 'eventId code')}`;
}

export function labsParticipantId(scopedEventId: string, tpId: string | number): string {
  const scope = requireIdSegment(scopedEventId, 'labsParticipantId scopedEventId');
  return `${scope}:${requireIdSegment(tpId, 'labsParticipantId tpId')}`;
}

export function onlineParticipantId(scopedEventId: string, handle: string): string {
  const scope = requireIdSegment(scopedEventId, 'onlineParticipantId scopedEventId');
  return `${scope}:${requireIdSegment(handle, 'onlineParticipantId handle')}`;
}

export interface ParsedCardUid {
  name: string;
  set: string | null;
  number: string | null;
}

export function parseCardIdentity(uid: string): ParsedCardUid | null {
  if (typeof uid !== 'string' || uid.length === 0) {
    return null;
  }
  const parsed = parseCardUid(uid);
  if (parsed) {
    return parsed;
  }
  return uid.includes('::') ? null : { name: uid, set: null, number: null };
}

export interface DeckIdCard {
  canonical: { uid: string };
  count: number;
}

export function deckId(participantId: string, cards: DeckIdCard[], hashValue: (value: unknown) => string): string {
  const scoped = requireIdSegment(participantId, 'deckId participantId');
  const cardKeys = cards
    .map(card => ({ uid: card.canonical.uid, count: card.count }))
    .sort((left, right) => (left.uid < right.uid ? -1 : left.uid > right.uid ? 1 : left.count - right.count));
  return `sha256:${hashValue({ schemaVersion: SCHEMA_VERSION, participantId: scoped, cards: cardKeys })}`;
}

export function matchId(round: number, phase: number, participantIds: string[]): string {
  if (!Number.isFinite(round) || !Number.isFinite(phase)) {
    throw new TypeError('matchId: round and phase must be finite numbers');
  }
  const ids = participantIds.map(id => requireIdSegment(id, 'matchId participantId')).sort();
  const pair = ids.length === 1 ? `solo:${ids[0]}` : `${ids[0]}|${ids[1]}`;
  return `r${round}:p${phase}:${pair}`;
}

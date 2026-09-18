import { playerRouteShard } from '../../../shared/playerObjectRoutes';

interface PlayerReads {
  routed: boolean;
  legacy<T>(path: string): Promise<T | null>;
  routes(path: string): Promise<Record<string, string>>;
  immutable<T>(path: string): Promise<T>;
}

export function createPlayerBodyReader(reads: PlayerReads) {
  return async <T>(playerId: string, file: string): Promise<T | null> => {
    const relative = `${encodeURIComponent(playerId)}/${file}.json`;
    if (!reads.routed) {
      return reads.legacy<T>(`/players/${relative}`);
    }
    const routes = await reads.routes(`/players/_routes/${playerRouteShard(relative)}.json`);
    const target = routes[relative];
    if (!target) {
      return null;
    }
    if (!/^\/releases\/v1\/players\/[a-f0-9]{12,64}\/[^/]+\/(profile|decks)\.json$/.test(target)) {
      throw new Error('Invalid immutable player reference');
    }
    return reads.immutable<T>(target);
  };
}

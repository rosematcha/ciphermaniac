import { composeRelease } from '../../shared/data/build/release';
import tournaments from '../fixtures/e2e/reports/tournaments.json';

const scopes = {
  catalogs: 'reports',
  online: 'reports/Online - Last 14 Days',
  trends: 'reports/Trends - Last 30 Days',
  players: 'players',
  prices: 'reports',
  snapshots: 'reports/Snapshots',
  assets: 'assets'
};

export const fixtureRelease = composeRelease({
  releaseId: 'browser-fixture',
  publishedAt: '2026-09-12T00:00:00Z',
  roots: Object.fromEntries(Object.keys(scopes).map(scope => [scope, `/releases/v1/${scope}/aaaaaaaaaaaa`])) as Record<
    keyof typeof scopes,
    string
  >,
  events: Object.fromEntries(tournaments.map(folder => [folder, `/releases/v1/events/${folder}/aaaaaaaaaaaa`]))
});

const paths = [
  ...Object.entries(scopes).map(([scope, legacy]) => [
    fixtureRelease.roots[scope as keyof typeof scopes],
    `/${legacy}`
  ]),
  ...Object.entries(fixtureRelease.events).map(([folder, root]) => [root, `/reports/${folder}`])
];

export function fixtureLegacyPath(path: string): string {
  const match = paths.find(([root]) => path.startsWith(`${root}/`));
  return match ? `${match[1]}${path.slice(match[0].length)}` : path;
}

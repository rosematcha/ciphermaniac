/** What a store application says, for the API suites: Combat Power Gaming's league unless told another. */

import type { StoreApplication } from '../../shared/accounts/stores.ts';

export function storeApplication(leagueId = '6238620', overrides: Partial<StoreApplication> = {}): StoreApplication {
  return {
    leagueId,
    details: {
      name: 'Combat Power Gaming',
      address: '4522 Fredericksburg Rd #B64',
      city: 'San Antonio',
      region: 'TX',
      postal: '78201',
      country: 'US',
      website: 'https://combatpower.example',
      discord: '',
      phone: '210-555-0100',
      email: 'store@example.com',
      details: ''
    },
    place: { lat: 29.4928, lon: -98.552, timeZone: 'America/Chicago' },
    timeZone: 'America/Chicago',
    relationship: 'owner',
    certified: true,
    nights: [
      { id: 'sun', weekday: 0, time: '15:00', name: 'League night', fee: '5' },
      { id: 'wed', weekday: 3, time: '19:30', name: 'League night', fee: '5' }
    ],
    ...overrides
  };
}

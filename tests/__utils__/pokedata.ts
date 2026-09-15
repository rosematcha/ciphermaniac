/* eslint-disable camelcase -- Pokedata's API field names are snake_case; the fixtures mirror them exactly */

/**
 * Pokedata listing records for tests.
 *
 * The base record copies the real API's field set exactly (every key the live
 * endpoint returns), with the store's identifying details replaced by
 * fictional ones.
 */

export type RawPokedataEvent = Record<string, unknown>;

const BASE: RawPokedataEvent = {
  type: 'League Cup',
  name: 'Test Games League Cup',
  date: '2026-09-20',
  shop: 'TEST GAMES',
  street_address: '100 MAIN ST, AUSTIN, TX 78701, US',
  state: 'Texas',
  city: 'Austin',
  postal_code: '',
  country_code: 'US',
  pokemon_url: 'https://www.pokemon.com/us/pokemon-trainer-club/play-pokemon-tournaments/26-09-000001/',
  guid: '00000000-0000-4000-8000-000000000001',
  latitude: '30.2672',
  longitude: '-97.7431',
  when: '2026-09-20 11:00:00',
  status: '',
  totalPlayers: '0',
  TCaccounts: '0',
  juniors: '0',
  seniors: '0',
  masters: '0',
  league: '1000001',
  category: '',
  tournament_date: '',
  tournament_completed: '',
  date_added: '2026-09-01',
  contact_email: 'events@example.com',
  contact_phone: '5125550100',
  Details: 'Standard format. Best of three swiss.\n\n\n\nBring a deck list.',
  Display_id: '26-09-000001',
  Event_website: 'www.example.com',
  Guid: '00000000-0000-4000-8000-000000000001',
  Name: 'Test Games League Cup',
  Products: 'tcg',
  Registration_end: '2026-09-20T11:00:00Z',
  Registration_start: '2026-09-20T10:00:00+00:00',
  Start_date: '2026-09-20T11:00:00Z',
  Status: 'sanctioned',
  Subtype: '',
  Third_party_registration_website: '',
  Admission: '$15',
  Admission_Juniors: '',
  Admission_Masters: '',
  Admission_Seniors: '',
  time: '11:00:00'
};

/** A valid League Cup in Austin; override any field. */
export function rawEvent(overrides: RawPokedataEvent = {}): RawPokedataEvent {
  return { ...BASE, ...overrides };
}

/** A distinct event: its own ID and pokemon.com URL, plus any overrides. */
export function rawEventWithId(serial: number, overrides: RawPokedataEvent = {}): RawPokedataEvent {
  const id = `26-09-${String(serial).padStart(6, '0')}`;
  return rawEvent({
    Display_id: id,
    pokemon_url: `https://www.pokemon.com/us/pokemon-trainer-club/play-pokemon-tournaments/${id}/`,
    ...overrides
  });
}

/** A page body as the API returns it. */
export function pageBody(events: RawPokedataEvent[], totalItems: number, totalPages: number, page = 1): string {
  return JSON.stringify({
    metadata: { total_items: totalItems, total_pages: totalPages, current_page: page, limit: 100 },
    events
  });
}

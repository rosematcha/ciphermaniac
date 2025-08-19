// Tournament configuration and archetype list (base names, no extensions)
export const REPORTS_BASE = 'reports';
// List of available tournaments (folder names under reports/)
// export const TOURNAMENTS = [
//   'World Championships 2025',
//   'NAIC 2025, New Orleans',
//   'Regionals Portland, OR',
//   'Regional Melbourne'
// ];
// export const DEFAULT_TOURNAMENT = TOURNAMENTS[0];

// Base names that map to `${REPORTS_BASE}/${TOURNAMENT_NAME}/archetypes/<name>.json`
export const ARCHETYPES = [
  'Blissey',
  'Charizard_Dragapult',
  'Charizard_Dusknoir',
  'Charizard_Pidgeot',
  'Dragapult_Dusknoir',
  'Dragapult',
  'Flareon_Noctowl',
  'Gardevoir',
  'Gholdengo_Joltik_Box',
  'Gholdengo',
  'Grimmsnarl_Froslass',
  'Ho-Oh_Armarouge',
  'Joltik_Box',
  'Milotic_Farigiraf',
  'Ns_Zoroark',
  'Raging_Bolt_Ogerpon',
  'Tera_Box'
];

// Back-compat mapping to old .txt file names
// No legacy TXT usage; JSON-only

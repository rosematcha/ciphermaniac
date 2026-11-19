import { type CardFilters, countActiveCardFilters, type PriceBand } from '../../lib/cardFilters';
import { createPersistentSignal } from '../../lib/persistentSignal';

export type TypeFilter = 'all' | 'pokemon' | 'trainer' | 'energy';
type Subtype = string; // 'all' or a trainer/energy subtype value
export type RegMark = 'all' | 'G' | 'H' | 'I' | 'J';

// Contextual subtype options, keyed by the parent type. Only trainers and
// energy carry a meaningful subdivision; Pokémon show no subtype group.
const SUBTYPE_OPTIONS: Record<'trainer' | 'energy', { value: string; label: string }[]> = {
  trainer: [
    { value: 'supporter', label: 'Supporter' },
    { value: 'item', label: 'Item' },
    { value: 'tool', label: 'Tool' },
    { value: 'stadium', label: 'Stadium' }
  ],
  energy: [
    { value: 'basic', label: 'Basic' },
    { value: 'special', label: 'Special' }
  ]
};

export const REG_MARKS: RegMark[] = ['G', 'H', 'I', 'J'];

export const PRICE_BANDS: { value: PriceBand; label: string }[] = [
  { value: 'lt1', label: 'Under $1' },
  { value: '1to5', label: '$1–5' },
  { value: '5to15', label: '$5–15' },
  { value: 'gte15', label: '$15+' }
];

/**
 * Metadata filters (shared by the desktop bar and the mobile sheet). Each is
 * an independent persistent signal so the URL-less session state survives a
 * reload the same way the type/sort filters already do.
 */
export function createCardFilterState() {
  const [typeFilter, setTypeFilter] = createPersistentSignal<TypeFilter>(
    'cm:cardsType',
    'all',
    v => (v === 'all' || v === 'pokemon' || v === 'trainer' || v === 'energy' ? v : null),
    sessionStorage
  );
  const [subtype, setSubtype] = createPersistentSignal<Subtype>('cm:cardsSubtype', 'all', v => v, sessionStorage);
  const [reg, setReg] = createPersistentSignal<RegMark>(
    'cm:cardsReg',
    'all',
    v => (v === 'all' || v === 'G' || v === 'H' || v === 'I' || v === 'J' ? v : null),
    sessionStorage
  );
  const [aceSpec, setAceSpec] = createPersistentSignal<'true' | 'false'>(
    'cm:cardsAceSpec',
    'false',
    v => (v === 'true' || v === 'false' ? v : null),
    sessionStorage
  );
  const [priceBand, setPriceBand] = createPersistentSignal<'all' | PriceBand>(
    'cm:cardsPriceBand',
    'all',
    v => (v === 'all' || v === 'lt1' || v === '1to5' || v === '5to15' || v === 'gte15' ? v : null),
    sessionStorage
  );

  // Snapshot of the metadata facets in the shape the pure predicate expects.
  const cardFilters = (): CardFilters => ({
    type: typeFilter(),
    subtype: subtype(),
    reg: reg(),
    aceSpec: aceSpec() === 'true',
    priceBand: priceBand()
  });

  // Changing the top-level type invalidates any contextual subtype (a trainer
  // subtype is meaningless once Energy is selected), so clear it in lockstep.
  function selectType(next: TypeFilter) {
    setTypeFilter(next);
    setSubtype('all');
  }

  // Subtype options for whichever specific type is selected; empty for
  // Pokémon / "all", which suppresses the group entirely.
  const subtypeOptions = () => {
    const t = typeFilter();
    return t === 'trainer' || t === 'energy' ? SUBTYPE_OPTIONS[t] : [];
  };

  function clearFilters() {
    setTypeFilter('all');
    setSubtype('all');
    setReg('all');
    setAceSpec('false');
    setPriceBand('all');
  }

  return {
    typeFilter,
    subtype,
    setSubtype,
    reg,
    setReg,
    aceSpec,
    setAceSpec,
    priceBand,
    setPriceBand,
    cardFilters,
    activeFilterCount: () => countActiveCardFilters(cardFilters()),
    selectType,
    subtypeOptions,
    clearFilters
  };
}

export type CardFilterState = ReturnType<typeof createCardFilterState>;

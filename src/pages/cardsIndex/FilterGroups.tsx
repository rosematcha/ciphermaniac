import { For, Show } from 'solid-js';
import { ChipGroup } from '../../components/Chip';
import type { PriceBand } from '../../lib/cardFilters';
import { type CardFilterState, PRICE_BANDS, REG_MARKS, type RegMark, type TypeFilter } from './filterState';

// The five metadata filter groups, shared verbatim by the mobile sheet and
// the desktop disclosure panel so the two surfaces never drift apart. Sort
// and View stay out: they are sheet-only additions (desktop keeps its
// segmented controls inline).
export function FilterGroups(props: { filters: CardFilterState }) {
  return (
    <>
      <div class='group'>
        <p class='group-label'>Card type</p>
        <ChipGroup
          options={[
            { value: 'all', label: 'All types' },
            { value: 'pokemon', label: 'Pokémon' },
            { value: 'trainer', label: 'Trainer' },
            { value: 'energy', label: 'Energy' }
          ]}
          selected={props.filters.typeFilter()}
          onSelect={v => props.filters.selectType(v as TypeFilter)}
        />
      </div>

      <Show when={props.filters.subtypeOptions().length > 0}>
        <div class='group'>
          <p class='group-label'>Subtype</p>
          <ChipGroup
            options={[{ value: 'all', label: 'All subtypes' }, ...props.filters.subtypeOptions()]}
            selected={props.filters.subtype()}
            onSelect={props.filters.setSubtype}
          />
        </div>
      </Show>

      <div class='group'>
        <p class='group-label'>Regulation mark</p>
        <p class='group-caption'>Post-rotation legality</p>
        <ChipGroup
          options={[{ value: 'all', label: 'All regs' }, ...REG_MARKS.map(m => ({ value: m, label: `Reg ${m}` }))]}
          selected={props.filters.reg()}
          onSelect={v => props.filters.setReg(v as RegMark)}
        />
      </div>

      <div class='group group-inline'>
        <p class='group-label'>Ace Spec</p>
        <div class='chips'>
          <button
            type='button'
            class='chip'
            aria-pressed={props.filters.aceSpec() === 'true' ? 'true' : 'false'}
            onClick={() => props.filters.setAceSpec(v => (v === 'true' ? 'false' : 'true'))}
          >
            Ace Spec only
          </button>
        </div>
      </div>

      <div class='group'>
        <p class='group-label'>Price band</p>
        <ChipGroup
          options={[{ value: 'all', label: 'All prices' }, ...PRICE_BANDS]}
          selected={props.filters.priceBand()}
          onSelect={v => props.filters.setPriceBand(v as 'all' | PriceBand)}
        />
      </div>
    </>
  );
}

// Removable summary chips for the active filters. Each carries the label and
// its own clear.
function summaryChips(f: CardFilterState) {
  const chips: { key: string; label: string; clear: () => void }[] = [];
  const t = f.typeFilter();
  if (t !== 'all') {
    const label = t === 'pokemon' ? 'Pokémon' : t === 'trainer' ? 'Trainer' : 'Energy';
    chips.push({ key: 'type', label, clear: () => f.selectType('all') });
  }
  if (f.subtype() !== 'all') {
    const opt = f.subtypeOptions().find(o => o.value === f.subtype());
    chips.push({ key: 'subtype', label: opt?.label ?? f.subtype(), clear: () => f.setSubtype('all') });
  }
  if (f.reg() !== 'all') {
    chips.push({ key: 'reg', label: `Reg ${f.reg()}`, clear: () => f.setReg('all') });
  }
  if (f.aceSpec() === 'true') {
    chips.push({ key: 'ace', label: 'Ace Spec', clear: () => f.setAceSpec('false') });
  }
  if (f.priceBand() !== 'all') {
    const opt = PRICE_BANDS.find(o => o.value === f.priceBand());
    chips.push({ key: 'price', label: opt?.label ?? f.priceBand(), clear: () => f.setPriceBand('all') });
  }
  return chips;
}

// Active-filter summary: removable mini-chips, shown on every breakpoint
// whenever filters are set (the facets themselves are hidden behind the
// trigger, so this is the at-rest state readout).
export function FilterStrip(props: { filters: CardFilterState }) {
  const chips = () => summaryChips(props.filters);
  return (
    <Show when={chips().length > 0}>
      <div class='filter-strip' aria-label='Active filters'>
        <For each={chips()}>
          {chip => (
            <button
              type='button'
              class='mini-chip'
              aria-label={`Remove ${chip.label} filter`}
              onClick={() => chip.clear()}
            >
              {chip.label}
              <span class='mc-x' aria-hidden='true'>
                ✕
              </span>
            </button>
          )}
        </For>
      </div>
    </Show>
  );
}

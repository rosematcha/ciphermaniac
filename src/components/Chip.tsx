import { For, type JSX, type ParentComponent } from 'solid-js';

interface ChipProps {
  pressed?: boolean;
  onClick?: () => void;
  label?: string;
  ariaLabel?: string;
}

const Chip: ParentComponent<ChipProps> = props => {
  return (
    <button
      type='button'
      class='chip'
      aria-pressed={props.pressed ? 'true' : 'false'}
      aria-label={props.ariaLabel}
      onClick={() => props.onClick?.()}
    >
      {props.children ?? props.label}
    </button>
  );
};

interface ChipGroupProps {
  options: { value: string; label: string }[];
  selected: string;
  onSelect: (value: string) => void;
}

export const ChipGroup: ParentComponent<ChipGroupProps> = props => {
  return (
    <div class='chips' role='group'>
      <For each={props.options}>
        {opt => (
          <Chip pressed={props.selected === opt.value} onClick={() => props.onSelect(opt.value)}>
            {opt.label}
          </Chip>
        )}
      </For>
    </div>
  );
};

interface SearchInputProps {
  value: string;
  onInput: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
}

export function SearchInput(props: SearchInputProps): JSX.Element {
  return (
    <input
      class='search'
      type='search'
      placeholder={props.placeholder ?? 'Search...'}
      aria-label={props.ariaLabel ?? props.placeholder ?? 'Search'}
      value={props.value}
      onInput={e => props.onInput(e.currentTarget.value)}
    />
  );
}

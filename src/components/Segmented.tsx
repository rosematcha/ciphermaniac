import { For } from 'solid-js';

interface SegmentedProps<T extends string> {
  options: { value: T; label: string }[];
  selected: T;
  onSelect: (value: T) => void;
  ariaLabel?: string;
}

/**
 * Segmented control — for short toggles (e.g., slice = all/phase2/topcut).
 */
export function Segmented<T extends string>(props: SegmentedProps<T>) {
  return (
    <div class='segmented' role='tablist' aria-label={props.ariaLabel}>
      <For each={props.options}>
        {opt => (
          <button
            type='button'
            role='tab'
            class={props.selected === opt.value ? 'active' : ''}
            aria-selected={props.selected === opt.value ? 'true' : 'false'}
            onClick={() => props.onSelect(opt.value)}
          >
            {opt.label}
          </button>
        )}
      </For>
    </div>
  );
}

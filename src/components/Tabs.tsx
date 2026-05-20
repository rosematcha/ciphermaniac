import { For } from 'solid-js';

interface TabsProps<T extends string> {
  options: { value: T; label: string }[];
  selected: T;
  onSelect: (value: T) => void;
  ariaLabel?: string;
}

/**
 * Underline tabs — for big in-page section navigation.
 */
export function Tabs<T extends string>(props: TabsProps<T>) {
  return (
    <nav class='tabs' role='tablist' aria-label={props.ariaLabel ?? 'Section'}>
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
    </nav>
  );
}

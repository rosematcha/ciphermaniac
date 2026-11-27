/**
 * The formats a user typed in on the Formats tab: their list, and the
 * placement bookkeeping that keeps a rename or delete from stranding a tile.
 * @module pages/tierList/customFormats
 */

import { batch, createSignal } from 'solid-js';
import { customFormatItem, reportCustomFormat } from './formats';
import { type CustomFormat, type Placement, withRenamedPlacement } from './model';

interface CustomFormatDeps {
  setPlacement: (update: (map: Placement) => Placement) => void;
  /** Runs inside the same batch as the edit, to close the editor with it. */
  onDone: () => void;
}

export function useCustomFormats({ setPlacement, onDone }: CustomFormatDeps) {
  const [customFormats, setCustomFormats] = createSignal<CustomFormat[]>([]);

  function saveFormat(draft: CustomFormat): void {
    const existing = customFormats().find(c => c.id === draft.id);
    batch(() => {
      if (existing) {
        setPlacement(map => withRenamedPlacement(map, customFormatItem(existing).id, customFormatItem(draft).id));
        setCustomFormats(list => list.map(c => (c.id === draft.id ? { ...draft } : c)));
      } else {
        // Only unique among formats: the Formats tab never shows an archetype's
        // edit control, so the two id spaces cannot meet.
        setCustomFormats(list => [...list, { ...draft, id: Math.max(0, ...list.map(c => c.id)) + 1 }]);
      }
      onDone();
    });
    reportCustomFormat(draft.name);
  }

  function deleteFormat(id: number): void {
    const gone = customFormats().find(c => c.id === id);
    batch(() => {
      if (gone) {
        const itemId = customFormatItem(gone).id;
        setPlacement(map => new Map([...map].map(([zone, ids]) => [zone, ids.filter(other => other !== itemId)])));
        setCustomFormats(list => list.filter(c => c.id !== id));
      }
      onDone();
    });
  }

  return { customFormats, setCustomFormats, saveFormat, deleteFormat };
}

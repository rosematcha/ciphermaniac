import { createSignal, onCleanup } from 'solid-js';
import { buildPtcglDeck, type PtcglEntry } from '../utils/ptcglExport';

/** Copies a decklist to the clipboard in PTCGL's import format; says "Copied" for a moment after. */
export function CopyDeckButton(props: { cards: PtcglEntry[] }) {
  const [copied, setCopied] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(timer));
  async function copy() {
    const { text } = buildPtcglDeck(props.cards);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      clearTimeout(timer);
      timer = setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }
  return (
    <button type='button' class='btn btn-secondary' onClick={() => void copy()}>
      {copied() ? 'Copied' : 'Copy for PTCGL'}
    </button>
  );
}

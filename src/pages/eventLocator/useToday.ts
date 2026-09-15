import { createSignal, onCleanup, onMount } from 'solid-js';
import { isoDate } from '../../lib/events/format';

/**
 * The visitor's local date, `YYYY-MM-DD`, kept current: it rolls over just
 * after midnight and is re-read when a tab left open comes back, so "Today"
 * and the date window never go stale.
 */
export function useToday() {
  const [today, setToday] = createSignal(isoDate(new Date()));
  onMount(() => {
    const refresh = () => setToday(isoDate(new Date()));
    const untilMidnight = () => {
      const now = new Date();
      return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime() + 1000;
    };
    let timer = setTimeout(function tick() {
      refresh();
      timer = setTimeout(tick, untilMidnight());
    }, untilMidnight());
    document.addEventListener('visibilitychange', refresh);
    onCleanup(() => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', refresh);
    });
  });
  return today;
}

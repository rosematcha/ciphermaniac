/**
 * A store's place, for its page: a still map of the streets around it with
 * its pin in the middle, drawn from the same OpenStreetMap tiles as the event
 * locator and credited the same way. Only the tiles in view are asked for.
 * The map opens the store's directions.
 */

import { createSignal, For, onCleanup, onMount } from 'solid-js';
import { type Size, visibleTiles } from '../../lib/events/mercator';

const ZOOM = 16;

export function StoreMap(props: { lat: number; lon: number; label: string }) {
  const [size, setSize] = createSignal<Size>({ width: 0, height: 0 });
  let frame: HTMLDivElement | undefined;
  onMount(() => {
    if (!frame) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      if (entry) {
        setSize({ width: Math.round(entry.contentRect.width), height: Math.round(entry.contentRect.height) });
      }
    });
    observer.observe(frame);
    onCleanup(() => observer.disconnect());
  });
  const tiles = () =>
    size().width > 0 ? visibleTiles({ center: { lat: props.lat, lon: props.lon }, zoom: ZOOM }, size()) : [];
  const directions = () => `https://www.google.com/maps/dir/?api=1&destination=${props.lat},${props.lon}`;
  return (
    <div class='tm-store-map' ref={el => (frame = el)}>
      <a
        class='tm-store-map-link'
        href={directions()}
        target='_blank'
        rel='noopener noreferrer'
        aria-label={`Directions to ${props.label}`}
      >
        <For each={tiles()}>
          {tile => (
            <img
              class='tm-store-tile'
              src={`https://tile.openstreetmap.org/${tile.z}/${tile.x}/${tile.y}.png`}
              alt=''
              width={tile.size}
              height={tile.size}
              style={{ transform: `translate(${tile.left}px, ${tile.top}px)` }}
              loading='lazy'
              decoding='async'
            />
          )}
        </For>
        <span class='tm-store-pin' aria-hidden='true' />
      </a>
      <a class='tm-store-credit' href='https://www.openstreetmap.org/copyright' target='_blank' rel='noopener'>
        © OpenStreetMap contributors
      </a>
    </div>
  );
}

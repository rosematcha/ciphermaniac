import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from 'solid-js';
import type { LatLon } from '../../lib/events/geo';
import type { VenueMarker } from '../../lib/events/filter';
import { titleCase } from '../../lib/events/format';
import {
  fitCircle,
  type Insets,
  kmPerPixel,
  type MapView,
  nearestWithin,
  panBy,
  type Point,
  type Size,
  toScreen,
  visibleTiles,
  zoomAround
} from '../../lib/events/mercator';
import { attachGestures } from './mapGestures';

/**
 * OpenStreetMap's standard tiles. Their policy allows interactive viewing
 * like this with the attribution shown on the map; it forbids prefetching
 * and offline use, so tiles are only ever requested for the visible area.
 */
function tileUrl(z: number, x: number, y: number): string {
  return `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
}

const WORLD_VIEW: MapView = { center: { lat: 25, lon: 0 }, zoom: 2 };
const KEY_PAN_PX = 80;
/** How far from a dot a tap on the map still opens it: fingers are wider than dots. */
const TAP_REACH_PX = 22;

export interface LocatorMapProps {
  center: LatLon | null;
  radiusKm: number;
  markers: VenueMarker[];
  /** Changes whenever the map should refit to the search circle. */
  fitKey: string;
  /** Map area covered by overlaid controls, kept clear when fitting. */
  insets: Insets;
  highlighted: string | null;
  onMarker: (marker: VenueMarker) => void;
  onMarkerHover: (key: string | null) => void;
}

/** A map of listed stores around the search centre. The list beside it is the accessible equivalent. */
export function LocatorMap(props: LocatorMapProps) {
  let el!: HTMLDivElement;
  const [size, setSize] = createSignal<Size>({ width: 0, height: 0 });
  const [view, setView] = createSignal<MapView>(WORLD_VIEW);

  const tiles = createMemo(() => (size().width > 0 ? visibleTiles(view(), size()) : []));
  // Keyed by tile address, so a pan moves existing images instead of reloading them.
  const tileKeys = createMemo(() => tiles().map(tile => tile.key));
  const tileByKey = createMemo(() => new Map(tiles().map(tile => [tile.key, tile])));
  const screen = (point: LatLon) => toScreen(point, view(), size());
  const ringPx = () => (props.center ? props.radiusKm / kmPerPixel(props.center.lat, view().zoom) : 0);

  // Dots keep their exact hit areas, so a near miss never lands on a neighbour;
  // a tap on the map itself opens the closest dot within reach.
  const tapNear = (point: Point) => {
    const marker = nearestWithin(props.markers, screen, point, TAP_REACH_PX);
    if (marker) {
      props.onMarker(marker);
    }
  };

  onMount(() => {
    const observer = new ResizeObserver(entries => {
      const box = entries[0]?.contentRect;
      if (box) {
        setSize({ width: box.width, height: box.height });
      }
    });
    observer.observe(el);
    const detach = attachGestures(el, { view, setView, size, onTap: tapNear });
    onCleanup(() => {
      observer.disconnect();
      detach();
    });
  });

  // Refit when the search changes, and once the map first has a size. A later
  // resize keeps whatever the visitor panned to.
  createEffect(
    on([() => props.fitKey, () => size().width > 0], ([, sized]) => {
      if (!sized) {
        return;
      }
      setView(props.center ? fitCircle(props.center, props.radiusKm, size(), props.insets) : WORLD_VIEW);
    })
  );

  const zoomBy = (step: number) => {
    const current = view();
    setView(zoomAround(current, size(), { x: size().width / 2, y: size().height / 2 }, current.zoom + step));
  };

  const KEY_ACTIONS: Record<string, () => void> = {
    ArrowLeft: () => setView(panBy(view(), KEY_PAN_PX, 0)),
    ArrowRight: () => setView(panBy(view(), -KEY_PAN_PX, 0)),
    ArrowUp: () => setView(panBy(view(), 0, KEY_PAN_PX)),
    ArrowDown: () => setView(panBy(view(), 0, -KEY_PAN_PX)),
    '+': () => zoomBy(1),
    '=': () => zoomBy(1),
    '-': () => zoomBy(-1)
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const action = e.target === el ? KEY_ACTIONS[e.key] : undefined;
    if (action) {
      e.preventDefault();
      action();
    }
  };

  return (
    <div
      class='lm'
      ref={el}
      tabindex='0'
      role='region'
      aria-roledescription='map'
      aria-label='Map of listed stores. Arrow keys pan, plus and minus zoom.'
      onKeyDown={onKeyDown}
    >
      <div class='lm-tiles' aria-hidden='true'>
        <For each={tileKeys()}>
          {key => (
            <Show when={tileByKey().get(key)}>
              {tile => (
                <img
                  class='lm-tile'
                  src={tileUrl(tile().z, tile().x, tile().y)}
                  alt=''
                  draggable={false}
                  decoding='async'
                  style={{
                    transform: `translate(${tile().left}px, ${tile().top}px)`,
                    width: `${tile().size}px`,
                    height: `${tile().size}px`
                  }}
                />
              )}
            </Show>
          )}
        </For>
      </div>
      {/* Markers are a pointer shortcut. The list beside the map holds every store and
          event with the same actions, and is the keyboard and screen-reader path: hundreds
          of focusable dots would bury it. */}
      <div class='lm-overlay' aria-hidden='true'>
        <Show when={props.center}>
          {center => (
            <>
              <div
                class='lm-ring'
                style={{
                  transform: `translate(${screen(center()).x - ringPx()}px, ${screen(center()).y - ringPx()}px)`,
                  width: `${ringPx() * 2}px`,
                  height: `${ringPx() * 2}px`
                }}
              />
              <div
                class='lm-pin'
                style={{ transform: `translate(${screen(center()).x}px, ${screen(center()).y}px)` }}
              />
            </>
          )}
        </Show>
        <For each={props.markers}>
          {marker => (
            <div
              class='lm-marker'
              classList={{ cup: marker.hasCup, hot: props.highlighted === marker.key }}
              style={{
                transform: `translate(${screen(marker).x}px, ${screen(marker).y}px)`,
                '--lm-size': `${Math.min(24, 11 + marker.count * 2)}px`
              }}
              title={`${titleCase(marker.shop)} · ${marker.count} event${marker.count === 1 ? '' : 's'}`}
              onPointerDown={e => e.stopPropagation()}
              onClick={() => props.onMarker(marker)}
              onPointerEnter={() => props.onMarkerHover(marker.key)}
              onPointerLeave={() => props.onMarkerHover(null)}
            />
          )}
        </For>
      </div>
      <div class='lm-zoom'>
        <button type='button' aria-label='Zoom in' onClick={() => zoomBy(1)}>
          +
        </button>
        <button type='button' aria-label='Zoom out' onClick={() => zoomBy(-1)}>
          −
        </button>
      </div>
      <a class='lm-credit' href='https://www.openstreetmap.org/copyright' target='_blank' rel='noopener'>
        © OpenStreetMap contributors
      </a>
    </div>
  );
}

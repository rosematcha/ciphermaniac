import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show, untrack } from 'solid-js';
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
  stepZoom,
  tileLevel,
  type TilePlacement,
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

interface UnderLayer {
  tiles: () => TilePlacement[];
  loaded: (key: string) => void;
}

/**
 * The tile level being left, kept until the current level's tiles are all
 * loaded. Loaded keys are remembered, so returning to a level shows it at once.
 */
function useUnderLayer(view: () => MapView, size: () => Size, tiles: () => TilePlacement[]): UnderLayer {
  const [loadedKeys, setLoadedKeys] = createSignal(new Set<string>(), { equals: false });
  const [level, setLevel] = createSignal<number | null>(null);
  const allLoaded = (placed: TilePlacement[]) => placed.every(tile => loadedKeys().has(tile.key));
  const ready = createMemo(() => allLoaded(tiles()));

  createEffect(
    on(
      () => tileLevel(view().zoom),
      (z, previous) => {
        // A level that never finished loading is not worth keeping; the one under it stays.
        if (previous === undefined || previous === z) {
          return;
        }
        const wasShown = untrack(() => allLoaded(visibleTiles(view(), size(), previous)));
        if (wasShown || level() === null) {
          setLevel(previous);
        }
      }
    )
  );
  createEffect(() => {
    if (level() !== null && ready() && tiles().length > 0) {
      setLevel(null);
    }
  });

  const underTiles = createMemo(() => {
    const z = level();
    return z === null || z === tileLevel(view().zoom) ? [] : visibleTiles(view(), size(), z);
  });
  return { tiles: underTiles, loaded: key => setLoadedKeys(keys => keys.add(key)) };
}

interface TileLayerProps {
  tiles: TilePlacement[];
  onLoad: (key: string) => void;
}

/** Tile images keyed by address, so a pan moves existing images instead of reloading them. */
function TileLayer(props: TileLayerProps) {
  const byKey = createMemo(() => new Map(props.tiles.map(tile => [tile.key, tile])));
  return (
    <For each={props.tiles.map(tile => tile.key)}>
      {key => (
        <Show when={byKey().get(key)}>
          {tile => (
            <img
              class='lm-tile'
              src={tileUrl(tile().z, tile().x, tile().y)}
              alt=''
              draggable={false}
              decoding='async'
              onLoad={() => props.onLoad(key)}
              onError={() => props.onLoad(key)}
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
  );
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
  // eslint-disable-next-line solid/reactivity -- the memo is read inside the hook's own tracked scopes
  const under = useUnderLayer(view, size, tiles);
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

  const zoomBy = (step: 1 | -1) => {
    const current = view();
    const centre = { x: size().width / 2, y: size().height / 2 };
    setView(zoomAround(current, size(), centre, stepZoom(current.zoom, step)));
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
        {/* The level the map is leaving stays underneath, rescaled, until the new
            level has fully loaded: a zoom then resolves in place instead of blanking. */}
        <TileLayer tiles={under.tiles()} onLoad={() => {}} />
        <TileLayer tiles={tiles()} onLoad={under.loaded} />
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

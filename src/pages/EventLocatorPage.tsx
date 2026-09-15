import {
  batch,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  Show
} from 'solid-js';
import { useSearchParams } from '@solidjs/router';
import { cellKeyFor, cellsForCircle } from '../../shared/events/cells';
import type { EventKind } from '../../shared/events/types';
import { fetchLocatorEvents, fetchLocatorIndex } from '../lib/data/eventLocator';
import { latestValue, resolved } from '../lib/resource';
import { filterEvents, groupByDay, type VenueMarker, venueMarkers } from '../lib/events/filter';
import { monthDay } from '../lib/events/format';
import { type DistanceUnit, type LatLon, toKm, unitForCountry } from '../lib/events/geo';
import { reverseGeocode } from '../lib/events/geocode';
import { approximateLabel, deviceLocation, DeviceLocationError, fetchApproximateLocation } from '../lib/events/locate';
import type { PlaceSuggestion } from '../lib/events/search';
import {
  centerFromParams,
  convertRadius,
  loadStored,
  type LocatorCenter,
  type LocatorParams,
  type LocatorSettings,
  paramsFor,
  saveStored,
  settingsFromParams,
  type WindowDays
} from '../lib/events/viewState';
import { EmptyState } from '../components/EmptyState';
import { Skeleton } from '../components/Skeleton';
import { EventList, eventPanelId } from './eventLocator/EventList';
import { LocatorToolbar } from './eventLocator/LocatorToolbar';
import { MapPanel } from './eventLocator/MapPanel';
import { useCollapsingMap } from './eventLocator/useCollapsingMap';
import { useToday } from './eventLocator/useToday';
import '../styles/pages/event-locator.css';

const LOCATE_ERRORS: Record<DeviceLocationError['reason'], string> = {
  denied: 'Location is blocked for this site.',
  unsupported: 'This browser can’t share a location.',
  unavailable: 'Couldn’t get a location. Try searching instead.'
};
const URL_WRITE_DELAY_MS = 300;

function countText(total: number, cups: number): string {
  const events = `${total} event${total === 1 ? '' : 's'}`;
  return cups ? `${events}, ${cups} Cup${cups === 1 ? '' : 's'}` : events;
}

export function EventLocatorPage() {
  const [params, setParams] = useSearchParams<LocatorParams & Record<string, string>>();
  const stored = loadStored();
  const initialCenter = centerFromParams(params) ?? stored.center;
  const [center, setCenter] = createSignal<LocatorCenter | null>(initialCenter);
  const [settings, setSettings] = createSignal<LocatorSettings>(settingsFromParams(params, stored.settings));
  const [locating, setLocating] = createSignal(false);
  const [locateError, setLocateError] = createSignal<string | null>(null);
  const [lookedUp, setLookedUp] = createSignal(Boolean(initialCenter));
  const [expanded, setExpanded] = createSignal<string | null>(null);
  const [hovered, setHovered] = createSignal<string | null>(null);
  const [pendingShop, setPendingShop] = createSignal<string | null>(null);
  const [fitNonce, setFitNonce] = createSignal(0);
  const today = useToday();
  // Newest location request wins: an older map click or lookup that resolves late is dropped.
  let request = 0;

  const [index, { refetch: retryIndex }] = createResource(fetchLocatorIndex);
  const radiusKm = () => toKm(settings().radius, settings().unit);
  const cellKey = createMemo(() => {
    const c = center();
    return c ? cellsForCircle(c.lat, c.lon, radiusKm()).join(' ') : '';
  });
  const [loaded, { refetch: retryEvents }] = createResource(
    () => {
      const i = resolved(index);
      const key = cellKey();
      return i && key ? { i, key } : false;
    },
    async ({ i, key }) => ({ cells: key.split(' '), events: await fetchLocatorEvents(i, key.split(' ')) })
  );
  /**
   * The loaded listings, when they cover the current centre. While a radius
   * grows the old ones stay up (no skeleton flash); a jump elsewhere waits for
   * its own cells rather than filtering the old area against the new point.
   */
  const usable = () => {
    const value = latestValue(loaded);
    const c = center();
    return value && c && value.cells.includes(cellKeyFor(c.lat, c.lon)) ? value.events : undefined;
  };

  const kinds = createMemo(() => new Set<EventKind>(settings().kinds));
  const placed = createMemo(() => {
    const c = center();
    const events = usable();
    if (!c || !events) {
      return [];
    }
    return filterEvents(events, {
      center: c,
      radiusKm: radiusKm(),
      kinds: kinds(),
      windowDays: settings().windowDays,
      today: today()
    });
  });
  const days = createMemo(() => groupByDay(placed()));
  const markers = createMemo(() => venueMarkers(placed()));
  const countries = createMemo(() => new Set(resolved(index)?.countries ?? []));
  const count = () =>
    center() && usable() ? countText(placed().length, placed().filter(e => e.kind === 'cup').length) : '';

  onMount(() => {
    document.title = 'Events — Ciphermaniac';
    if (!initialCenter) {
      void startFromApproximateLocation();
    }
  });

  /** Open on the edge's estimate, unless the visitor has chosen a place while it was on its way. */
  async function startFromApproximateLocation() {
    const ticket = ++request;
    const location = await fetchApproximateLocation();
    if (location && !center() && ticket === request) {
      choose({ ...location, label: approximateLabel(location), source: 'approximate' });
    }
    setLookedUp(true);
  }

  function choose(next: LocatorCenter) {
    request++;
    batch(() => {
      setCenter(next);
      setExpanded(null);
      setLocateError(null);
      if (next.cc && !settings().unitPinned) {
        const unit = unitForCountry(next.cc);
        setSettings(s => ({ ...s, unit }));
      }
      setFitNonce(n => n + 1);
    });
  }

  async function locateDevice() {
    setLocating(true);
    setLocateError(null);
    const ticket = ++request;
    try {
      const point = await deviceLocation();
      const place = await reverseGeocode(point).catch(() => null);
      if (ticket !== request) {
        return;
      }
      choose({ ...point, label: place?.label ?? 'Your location', cc: place?.cc ?? null, source: 'device' });
    } catch (error) {
      if (ticket === request) {
        setLocateError(error instanceof DeviceLocationError ? LOCATE_ERRORS[error.reason] : LOCATE_ERRORS.unavailable);
      }
    } finally {
      setLocating(false);
    }
  }

  async function pickPoint(point: LatLon) {
    const ticket = ++request;
    const place = await reverseGeocode(point).catch(() => null);
    if (ticket !== request) {
      return;
    }
    choose({
      ...point,
      label: place?.label ?? `${point.lat.toFixed(2)}, ${point.lon.toFixed(2)}`,
      cc: place?.cc ?? null,
      source: 'map'
    });
  }

  function pickPlace(place: PlaceSuggestion) {
    // Before choosing: the effect that opens the store's event runs as soon as
    // the new centre lands, and has to find the store already pending.
    setPendingShop(place.shop ?? null);
    choose({ lat: place.lat, lon: place.lon, label: place.centerLabel, cc: place.cc, source: 'search' });
  }

  const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  function reveal(id: string) {
    setExpanded(id);
    requestAnimationFrame(() =>
      document
        .getElementById(eventPanelId(id))
        ?.closest('.el-item')
        ?.scrollIntoView({ block: 'center', behavior: reduceMotion() ? 'auto' : 'smooth' })
    );
  }

  // A store picked from search opens its next event once that area's listings arrive.
  createEffect(
    on(placed, list => {
      const shop = pendingShop();
      if (!shop || loaded.loading) {
        return;
      }
      const hit = list.find(e => e.shop === shop);
      setPendingShop(null);
      if (hit) {
        reveal(hit.id);
      }
    })
  );

  const setUnit = (unit: DistanceUnit) => {
    setSettings(s => ({ ...s, unit, unitPinned: true, radius: convertRadius(s.radius, s.unit, unit) }));
    setFitNonce(n => n + 1);
  };
  const setWindow = (windowDays: WindowDays) => setSettings(s => ({ ...s, windowDays }));
  const toggleKind = (kind: EventKind) =>
    setSettings(s => ({ ...s, kinds: s.kinds.includes(kind) ? s.kinds.filter(k => k !== kind) : [...s.kinds, kind] }));

  createEffect(() => saveStored(center(), settings()));
  let urlTimer: ReturnType<typeof setTimeout> | undefined;
  createEffect(() => {
    const next = paramsFor(center(), settings());
    clearTimeout(urlTimer);
    urlTimer = setTimeout(() => setParams(next, { replace: true }), URL_WRITE_DELAY_MS);
  });
  onCleanup(() => clearTimeout(urlTimer));

  let layout!: HTMLDivElement;
  const { collapsed, expand } = useCollapsingMap(() => layout);

  const meta = () => {
    const c = center();
    if (!c) {
      return lookedUp() ? 'Search a place to see the events around it.' : '';
    }
    return `${settings().radius} ${settings().unit} around ${c.label}${c.source === 'approximate' ? ' (approximate)' : ''}`;
  };

  return (
    <>
      <section class='hero'>
        <h1>Events near you</h1>
        <div class='hero-meta'>{meta()}</div>
      </section>
      <LocatorToolbar
        kinds={kinds()}
        available={resolved(index)?.kinds ?? null}
        windowDays={settings().windowDays}
        unit={settings().unit}
        count={count()}
        onToggleKind={toggleKind}
        onWindow={setWindow}
        onUnit={setUnit}
      />
      <div class='el-layout' ref={layout}>
        <div class='el-map-slot'>
          <MapPanel
            index={resolved(index) ?? null}
            center={center()}
            centerLabel={center()?.label ?? ''}
            centerCountry={center()?.cc ?? null}
            countries={countries()}
            radius={settings().radius}
            radiusKm={radiusKm()}
            unit={settings().unit}
            markers={markers()}
            highlighted={hovered()}
            fitKey={String(fitNonce())}
            collapsed={collapsed()}
            locating={locating()}
            locateError={locateError()}
            onRadiusInput={radius => setSettings(s => ({ ...s, radius }))}
            onRadiusCommit={() => setFitNonce(n => n + 1)}
            onPickPlace={pickPlace}
            onPickPoint={point => void pickPoint(point)}
            onLocate={() => void locateDevice()}
            onMarker={(marker: VenueMarker) => reveal(marker.firstId)}
            onMarkerHover={setHovered}
            onExpand={expand}
          />
        </div>
        <div class='el-results'>
          <Results
            index={index}
            loaded={loaded}
            hasEvents={Boolean(usable())}
            center={center()}
            lookedUp={lookedUp()}
            days={days()}
            settings={settings()}
            countries={countries()}
            today={today()}
            expanded={expanded()}
            hovered={hovered()}
            onRetry={() => void (index.error ? retryIndex() : retryEvents())}
            onToggle={id => setExpanded(current => (current === id ? null : id))}
            onHover={setHovered}
            onWiden={radius => {
              setSettings(s => ({ ...s, radius }));
              setFitNonce(n => n + 1);
            }}
            onLonger={() => setWindow(settings().windowDays === 7 ? 30 : null)}
          />
          <Show when={resolved(index)}>
            {i => (
              <p class='el-credit'>
                Listings from{' '}
                <a href={i().source} target='_blank' rel='noopener'>
                  Pokedata
                </a>
                , updated {monthDay(i().generatedAt.slice(0, 10))}.
              </p>
            )}
          </Show>
        </div>
      </div>
    </>
  );
}

interface ResultsProps {
  index: ReturnType<typeof createResource<Awaited<ReturnType<typeof fetchLocatorIndex>>>>[0];
  loaded: { error: unknown };
  /** The current area's listings have arrived. */
  hasEvents: boolean;
  center: LocatorCenter | null;
  lookedUp: boolean;
  days: ReturnType<typeof groupByDay>;
  settings: LocatorSettings;
  countries: ReadonlySet<string>;
  today: string;
  expanded: string | null;
  hovered: string | null;
  onRetry: () => void;
  onToggle: (id: string) => void;
  onHover: (venue: string | null) => void;
  onWiden: (radius: number) => void;
  onLonger: () => void;
}

const WIDER = [100, 250];

function Results(props: ResultsProps) {
  const failed = () => Boolean(props.index.error || props.loaded.error);
  const loading = () => !resolved(props.index) || (props.center && !props.hasEvents);
  return (
    <Show
      when={!failed()}
      fallback={
        <EmptyState
          title='Couldn’t load events.'
          actions={
            <button type='button' class='btn btn-secondary' onClick={() => props.onRetry()}>
              Try again
            </button>
          }
        />
      }
    >
      <Show when={props.center || !props.lookedUp} fallback={null}>
        <Show when={!loading()} fallback={<ResultsSkeleton />}>
          <Show when={props.days.length} fallback={<NoResults {...props} />}>
            <EventList
              days={props.days}
              unit={props.settings.unit}
              today={props.today}
              expanded={props.expanded}
              highlighted={props.hovered}
              onToggle={props.onToggle}
              onHover={props.onHover}
            />
          </Show>
        </Show>
      </Show>
    </Show>
  );
}

function NoResults(props: ResultsProps) {
  const country = () => props.center?.cc ?? null;
  const unlisted = () => country() && props.countries.size > 0 && !props.countries.has(country() as string);
  const wider = () => WIDER.find(r => r > props.settings.radius);
  return (
    <Show
      when={!unlisted()}
      fallback={
        <EmptyState
          title={`No events listed in ${new Intl.DisplayNames(['en'], { type: 'region' }).of(country() as string) ?? country()}.`}
        />
      }
    >
      <EmptyState
        title={`Nothing ${props.settings.windowDays ? `in the next ${props.settings.windowDays} days` : 'listed'} within ${props.settings.radius} ${props.settings.unit}.`}
        actions={
          <>
            <Show when={wider()}>
              {radius => (
                <button type='button' class='btn btn-secondary' onClick={() => props.onWiden(radius())}>
                  Widen to {radius()} {props.settings.unit}
                </button>
              )}
            </Show>
            <Show when={props.settings.windowDays}>
              <button type='button' class='btn btn-ghost' onClick={() => props.onLonger()}>
                Look further ahead
              </button>
            </Show>
          </>
        }
      />
    </Show>
  );
}

const SKELETON_DAYS = [3, 2, 3];

function ResultsSkeleton() {
  return (
    <div class='el-days' aria-hidden='true'>
      <For each={SKELETON_DAYS}>
        {rows => (
          <section class='el-day'>
            <div class='el-day-head'>
              <Skeleton width='120px' height='13px' />
            </div>
            <ul class='el-list'>
              <For each={Array.from({ length: rows })}>
                {() => (
                  <li class='el-item el-skeleton'>
                    <div class='el-row'>
                      <Skeleton width='44px' height='12px' />
                      <span class='el-main'>
                        <Skeleton width='70%' height='13px' />
                        <Skeleton width='45%' height='12px' />
                      </span>
                    </div>
                  </li>
                )}
              </For>
            </ul>
          </section>
        )}
      </For>
    </div>
  );
}

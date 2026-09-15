import { Show } from 'solid-js';
import type { VenueMarker } from '../../lib/events/filter';
import type { DistanceUnit, LatLon } from '../../lib/events/geo';
import type { PlaceSuggestion } from '../../lib/events/search';
import { clampRadius, RADIUS_CHOICES, RADIUS_SLIDER_MAX } from '../../lib/events/viewState';
import type { Insets } from '../../lib/events/mercator';
import type { LocatorIndex } from '../../../shared/events/types';
import { LocatorMap } from './LocatorMap';
import { PlaceSearch } from './PlaceSearch';

/** Map area under the search box (top) and the radius control (bottom). */
const MAP_INSETS: Insets = { top: 64, right: 16, bottom: 64, left: 16 };
/** The strip of map left showing on phones once the list scrolls up. Matches --el-strip. */
const STRIP_PX = 116;

export interface MapPanelProps {
  index: LocatorIndex | null;
  center: LatLon | null;
  centerLabel: string;
  centerCountry: string | null;
  countries: ReadonlySet<string>;
  radius: number;
  radiusKm: number;
  unit: DistanceUnit;
  markers: VenueMarker[];
  highlighted: string | null;
  fitKey: string;
  collapsed: boolean;
  /** Phone layout, where the map scrolls away to a strip. */
  phone: boolean;
  locating: boolean;
  locateError: string | null;
  onRadiusInput: (radius: number) => void;
  onRadiusCommit: () => void;
  onPickPlace: (place: PlaceSuggestion) => void;
  onPickPoint: (point: LatLon) => void;
  onLocate: () => void;
  onMarker: (marker: VenueMarker) => void;
  onMarkerHover: (key: string | null) => void;
  onExpand: () => void;
}

/** The map and the controls that sit on it: search, locate, radius. */
export function MapPanel(props: MapPanelProps) {
  return (
    <div class='el-map-frame' classList={{ collapsed: props.collapsed }}>
      <div class='el-map-canvas'>
        <LocatorMap
          center={props.center}
          radiusKm={props.radiusKm}
          markers={props.markers}
          fitKey={props.fitKey}
          insets={MAP_INSETS}
          focusBand={props.phone ? STRIP_PX : 0}
          highlighted={props.highlighted}
          onMarker={props.onMarker}
          onMarkerHover={props.onMarkerHover}
          onPick={props.onPickPoint}
        />
      </div>
      <div class='el-map-top'>
        <PlaceSearch
          index={props.index}
          near={props.center}
          currentLabel={props.centerLabel}
          currentCountry={props.centerCountry}
          countries={props.countries}
          locating={props.locating}
          locateError={props.locateError}
          onPick={props.onPickPlace}
          onLocate={props.onLocate}
        />
        <button
          type='button'
          class='el-locate'
          classList={{ busy: props.locating }}
          aria-label='Use my location'
          title='Use my location'
          aria-busy={props.locating}
          onClick={() => props.onLocate()}
        >
          <svg viewBox='0 0 24 24' aria-hidden='true'>
            <circle cx='12' cy='12' r='3' />
            <path d='M12 2v4M12 18v4M2 12h4M18 12h4' />
            <circle cx='12' cy='12' r='8' />
          </svg>
        </button>
      </div>
      <Show when={props.center}>
        <label class='el-radius'>
          <span>Within</span>
          <input
            type='range'
            min={0}
            max={RADIUS_SLIDER_MAX}
            step={1}
            value={RADIUS_CHOICES.findIndex(choice => choice === clampRadius(props.radius))}
            aria-valuetext={`${props.radius} ${props.unit}`}
            onInput={e => props.onRadiusInput(RADIUS_CHOICES[Number(e.currentTarget.value)] ?? RADIUS_CHOICES[0])}
            onChange={() => props.onRadiusCommit()}
          />
          <output>
            {props.radius} {props.unit}
          </output>
        </label>
      </Show>
      <div class='el-map-collapse' aria-hidden='true' />
      <button type='button' class='el-map-expand' aria-label='Show the map' onClick={() => props.onExpand()} />
    </div>
  );
}

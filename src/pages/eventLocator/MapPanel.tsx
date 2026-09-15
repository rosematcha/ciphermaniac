import type { VenueMarker } from '../../lib/events/filter';
import type { LatLon } from '../../lib/events/geo';
import type { PlaceSuggestion } from '../../lib/events/search';
import type { Insets } from '../../lib/events/mercator';
import type { LocatorIndex } from '../../../shared/events/types';
import { FiltersIcon } from './LocatorFilters';
import { LocatorMap } from './LocatorMap';
import { PlaceSearch } from './PlaceSearch';

/** Map area under the search row, kept clear when fitting the circle. */
const MAP_INSETS: Insets = { top: 64, right: 16, bottom: 24, left: 16 };

export interface MapPanelProps {
  index: LocatorIndex | null;
  center: LatLon | null;
  centerLabel: string;
  centerCountry: string | null;
  countries: ReadonlySet<string>;
  /** The empty search box shows the current place. */
  searchPlaceholder: string;
  radiusKm: number;
  markers: VenueMarker[];
  highlighted: string | null;
  fitKey: string;
  locating: boolean;
  locateError: string | null;
  onPickPlace: (place: PlaceSuggestion) => void;
  onLocate: () => void;
  /** Opens the phone's filter sheet. The button is only shown on phones. */
  onFilters: () => void;
  onMarker: (marker: VenueMarker) => void;
  onMarkerHover: (key: string | null) => void;
}

/** The map and the controls that sit on it: search, filters (phones) and locate. */
export function MapPanel(props: MapPanelProps) {
  return (
    <div class='el-map-frame'>
      <div class='el-map-canvas'>
        <LocatorMap
          center={props.center}
          radiusKm={props.radiusKm}
          markers={props.markers}
          fitKey={props.fitKey}
          insets={MAP_INSETS}
          highlighted={props.highlighted}
          onMarker={props.onMarker}
          onMarkerHover={props.onMarkerHover}
        />
      </div>
      <div class='el-map-top'>
        <PlaceSearch
          index={props.index}
          near={props.center}
          currentLabel={props.centerLabel}
          currentCountry={props.centerCountry}
          countries={props.countries}
          placeholder={props.searchPlaceholder}
          locating={props.locating}
          locateError={props.locateError}
          onPick={props.onPickPlace}
          onLocate={props.onLocate}
        />
        <button
          type='button'
          class='el-map-button el-filter-trigger'
          aria-label='Filters'
          aria-haspopup='dialog'
          onClick={() => props.onFilters()}
        >
          <FiltersIcon />
        </button>
        <button
          type='button'
          class='el-map-button el-locate'
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
    </div>
  );
}

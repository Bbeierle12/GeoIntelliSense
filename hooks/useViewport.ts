/**
 * Viewport state hook for map-driven API queries.
 * Tracks the map's bounding box and zoom level, debounces updates,
 * and provides a bbox string for URL construction.
 */

import { useState, useCallback, useRef } from 'react';

export interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface ViewportState {
  bbox: BBox;
  zoom: number;
  center: { lat: number; lng: number };
}

// Default: San Joaquin Valley
const DEFAULT_BBOX: BBox = { south: 34.5, west: -121.0, north: 37.5, east: -117.5 };
const DEFAULT_CENTER = { lat: 35.37, lng: -119.02 };
const DEFAULT_ZOOM = 9;

// Zoom thresholds — layers below their minimum zoom won't fetch data
export const ZOOM_THRESHOLDS: Record<string, number> = {
  fires: 3,
  earthquakes: 3,
  aqi: 6,
  water: 6,
  wells: 9,
  waterQuality: 9,
  enviroscreen: 8,
};

/** Format bbox as "south,west,north,east" for query params */
export function bboxToString(bbox: BBox): string {
  // Round to 2 decimals for better cache hit rates
  return `${bbox.south.toFixed(2)},${bbox.west.toFixed(2)},${bbox.north.toFixed(2)},${bbox.east.toFixed(2)}`;
}

export function useViewport() {
  const [viewport, setViewportState] = useState<ViewportState>({
    bbox: DEFAULT_BBOX,
    zoom: DEFAULT_ZOOM,
    center: DEFAULT_CENTER,
  });

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastBboxRef = useRef<string>(bboxToString(DEFAULT_BBOX));

  const updateViewport = useCallback((bounds: { getNorthEast: () => { lat: () => number; lng: () => number }; getSouthWest: () => { lat: () => number; lng: () => number } }, zoom: number) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => {
      const ne = bounds.getNorthEast();
      const sw = bounds.getSouthWest();
      const newBbox: BBox = {
        south: sw.lat(),
        west: sw.lng(),
        north: ne.lat(),
        east: ne.lng(),
      };

      const newBboxStr = bboxToString(newBbox);

      // Skip if bbox changed by less than ~5% (tiny pans)
      if (newBboxStr === lastBboxRef.current) return;
      lastBboxRef.current = newBboxStr;

      setViewportState({
        bbox: newBbox,
        zoom,
        center: {
          lat: (newBbox.south + newBbox.north) / 2,
          lng: (newBbox.west + newBbox.east) / 2,
        },
      });
    }, 500);
  }, []);

  const bboxString = bboxToString(viewport.bbox);

  return {
    ...viewport,
    bboxString,
    updateViewport,
  };
}

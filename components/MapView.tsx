import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MarkerClusterer } from '@googlemaps/markerclusterer';
import { MapIcon } from './icons/MapIcon';
import { KeyIcon } from './icons/KeyIcon';
import { SearchIcon } from './icons/SearchIcon';
import {
  useLiveData,
  useAqiSnapshot,
  type AqiSnapshot,
  type FiresData,
  type EarthquakeData,
  type WaterData,
} from '../hooks/useLiveData';
import { useViewport, ZOOM_THRESHOLDS } from '../hooks/useViewport';

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL || 'http://localhost:8080';

// ── Types ───────────────────────────────────────────

interface LayerState {
  aqi: boolean;
  fires: boolean;
  earthquakes: boolean;
  water: boolean;
  wells: boolean;
  enviroscreen: boolean;
  waterQuality: boolean;
}

interface WellsResponse {
  count: number;
  wells: Array<{ apiNumber: string; name: string; wellType: string; status: string; operator: string; lat: number; lng: number; depthFt: number }>;
}

interface WqWellsResponse {
  count: number;
  wells: Array<{ siteId: string; siteName: string; lat: number; lng: number; parameters: Record<string, { value: number; unit: string; level: string; exceedsMCL: boolean }> }>;
}

// ── Color helpers ───────────────────────────────────

const getAqiColor = (aqi: number) => {
  if (aqi <= 50) return '#22c55e';
  if (aqi <= 100) return '#facc15';
  if (aqi <= 150) return '#f97316';
  if (aqi <= 200) return '#ef4444';
  if (aqi <= 300) return '#a855f7';
  return '#881337';
};

const getAqiCategory = (aqi: number) => {
  if (aqi <= 50) return 'Good';
  if (aqi <= 100) return 'Moderate';
  if (aqi <= 150) return 'Unhealthy for Sensitive Groups';
  if (aqi <= 200) return 'Unhealthy';
  if (aqi <= 300) return 'Very Unhealthy';
  return 'Hazardous';
};

const mapStyles = [
  { elementType: 'geometry', stylers: [{ color: '#1e293b' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#94a3b8' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1e293b' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#475569' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#e2e8f0' }] },
  { featureType: 'road', elementType: 'geometry.fill', stylers: [{ color: '#334155' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#0284c7' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0f172a' }] },
];

// ── Layer definitions ───────────────────────────────

const LAYER_CONFIG: { key: keyof LayerState; label: string; color: string; icon: string }[] = [
  { key: 'aqi', label: 'AQI Stations', color: '#22c55e', icon: 'A' },
  { key: 'fires', label: 'Active Fires', color: '#ef4444', icon: 'F' },
  { key: 'earthquakes', label: 'Earthquakes', color: '#8b5cf6', icon: 'E' },
  { key: 'water', label: 'Water Stations', color: '#06b6d4', icon: 'W' },
  { key: 'wells', label: 'Oil/Gas Wells', color: '#78716c', icon: 'O' },
  { key: 'waterQuality', label: 'Water Quality', color: '#f59e0b', icon: 'Q' },
  { key: 'enviroscreen', label: 'EnviroScreen', color: '#ec4899', icon: 'S' },
];

// ── Main Component ──────────────────────────────────

const MapView: React.FC = () => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const clustererRef = useRef<MarkerClusterer | null>(null);
  const activeInfoRef = useRef<google.maps.InfoWindow | null>(null);

  const isScriptLoaded = useRef(false);
  const [isApiReady, setIsApiReady] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchError, setSearchError] = useState<string | null>(null);

  const [layers, setLayers] = useState<LayerState>({
    aqi: true,
    fires: true,
    earthquakes: true,
    water: true,
    wells: false,
    enviroscreen: false,
    waterQuality: false,
  });

  // ── Viewport tracking ───────────────────────────────

  const { bbox, bboxString, zoom, center, updateViewport } = useViewport();

  // ── Data hooks (viewport-aware) ───────────────────

  const { data: aqiData } = useAqiSnapshot();

  const { data: firesData } = useLiveData<FiresData>(
    `/api/fires/active?bbox=${bboxString}`,
    { refreshInterval: 300_000, enabled: layers.fires && zoom >= ZOOM_THRESHOLDS.fires },
  );

  const { data: quakeData } = useLiveData<EarthquakeData>(
    `/api/earthquakes/recent?days=7&min_magnitude=2.0&lat=${center.lat.toFixed(4)}&lon=${center.lng.toFixed(4)}&bbox=${bboxString}`,
    { refreshInterval: 300_000, enabled: layers.earthquakes && zoom >= ZOOM_THRESHOLDS.earthquakes },
  );

  const { data: waterData } = useLiveData<WaterData>(
    `/api/water/current?bbox=${bboxString}`,
    { refreshInterval: 900_000, enabled: layers.water && zoom >= ZOOM_THRESHOLDS.water },
  );

  // On-demand layers (only fetch when toggled on + zoomed in enough)
  const { data: wellsData } = useLiveData<WellsResponse>(
    `/api/calgem/wells?bbox=${bboxString}&limit=500`,
    { enabled: layers.wells && zoom >= ZOOM_THRESHOLDS.wells },
  );
  const { data: wqData } = useLiveData<WqWellsResponse>(
    `/api/water-quality/wells?bbox=${bboxString}&exceeds_only=true`,
    { enabled: layers.waterQuality && zoom >= ZOOM_THRESHOLDS.waterQuality },
  );

  // ── Load Google Maps ────────────────────────────────

  useEffect(() => {
    // Prevent double-load from React Strict Mode
    if (isScriptLoaded.current || window.google?.maps) {
      setIsApiReady(true);
      setIsLoading(false);
      return;
    }

    // Check if script tag already exists (from a previous mount)
    const existing = document.getElementById('google-maps-script');
    if (existing) {
      // Script is loading or loaded — wait for google.maps to appear
      const check = setInterval(() => {
        if (window.google?.maps) {
          clearInterval(check);
          isScriptLoaded.current = true;
          setIsApiReady(true);
          setIsLoading(false);
        }
      }, 100);
      return () => clearInterval(check);
    }

    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`${GATEWAY_URL}/api/maps-config`);
        if (!res.ok) throw new Error('maps-config fetch failed');
        const { apiKey } = await res.json();

        if (cancelled) return;

        const script = document.createElement('script');
        script.id = 'google-maps-script';
        script.async = true;
        script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
        script.onload = () => {
          isScriptLoaded.current = true;
          if (!cancelled) { setIsApiReady(true); setIsLoading(false); }
        };
        script.onerror = () => {
          if (!cancelled) { setError('Google Maps failed to load.'); setIsLoading(false); }
        };
        document.head.appendChild(script);
      } catch {
        if (!cancelled) {
          setError('Backend not available. Start services with docker compose up.');
          setIsLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, []);

  // ── Initialize map ──────────────────────────────────

  useEffect(() => {
    if (!isApiReady || !mapRef.current || mapInstanceRef.current) return;

    mapInstanceRef.current = new google.maps.Map(mapRef.current, {
      center: { lat: 35.37, lng: -119.02 },
      zoom: 9,
      styles: mapStyles,
      disableDefaultUI: true,
      zoomControl: true,
      mapTypeControl: true,
      mapTypeControlOptions: { position: google.maps.ControlPosition.TOP_RIGHT },
    });

    mapInstanceRef.current.addListener('click', () => {
      activeInfoRef.current?.close();
      activeInfoRef.current = null;
    });

    // Track viewport changes for dynamic data loading
    mapInstanceRef.current.addListener('idle', () => {
      const bounds = mapInstanceRef.current!.getBounds();
      if (bounds) {
        updateViewport(bounds, mapInstanceRef.current!.getZoom() || 9);
      }
    });
  }, [isApiReady, updateViewport]);

  // ── Render all markers ──────────────────────────────

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    // Clear previous
    markersRef.current.forEach(m => m.setMap(null));
    markersRef.current = [];
    if (clustererRef.current) { clustererRef.current.clearMarkers(); clustererRef.current = null; }

    const allMarkers: google.maps.Marker[] = [];

    // AQI markers
    if (layers.aqi && aqiData?.readings) {
      for (const r of aqiData.readings) {
        if (!r.lat || !r.lng) continue;
        const m = new google.maps.Marker({
          position: { lat: r.lat, lng: r.lng },
          title: `${r.stationName}: AQI ${r.aqi}`,
          icon: { path: google.maps.SymbolPath.CIRCLE, fillColor: getAqiColor(r.aqi), fillOpacity: 1, strokeColor: '#fff', strokeWeight: 1.5, scale: 14 },
          label: { text: String(r.aqi), color: r.aqi > 200 ? '#fff' : '#1e293b', fontSize: '11px', fontWeight: 'bold' },
        });
        m.addListener('click', () => openInfo(map, m, `
          <div style="background:#0f172a;color:#cbd5e1;padding:10px;border-radius:6px;min-width:180px;font-family:sans-serif;">
            <b style="color:#f1f5f9">${r.stationName}</b>
            <span style="background:${r.source === 'purpleair' ? '#7c3aed' : '#475569'};color:#fff;font-size:0.6rem;padding:1px 5px;border-radius:3px;margin-left:6px">${r.source === 'purpleair' ? 'LIVE' : r.source?.toUpperCase() || 'MOCK'}</span>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;margin-top:8px;font-size:0.85rem">
              <div>AQI: <b style="color:${getAqiColor(r.aqi)}">${r.aqi}</b></div>
              <div>PM2.5: <b>${r.pm25?.toFixed(1)}</b></div>
              <div>Temp: <b style="color:#f87171">${Math.round(r.temperature || 0)}°F</b></div>
              <div>Humidity: <b style="color:#38bdf8">${Math.round(r.humidity || 0)}%</b></div>
            </div>
            <p style="margin:6px 0 0;font-size:0.7rem;color:#64748b;border-top:1px solid #334155;padding-top:4px">${getAqiCategory(r.aqi)}</p>
          </div>
        `));
        allMarkers.push(m);
      }
    }

    // Fire markers
    if (layers.fires && firesData?.fires) {
      for (const f of firesData.fires) {
        const m = new google.maps.Marker({
          position: { lat: f.lat, lng: f.lng },
          title: `Fire: FRP ${f.frp} MW, ${f.distanceKm?.toFixed(0)}km away`,
          icon: { path: google.maps.SymbolPath.BACKWARD_CLOSED_ARROW, fillColor: '#ef4444', fillOpacity: 0.9, strokeColor: '#fbbf24', strokeWeight: 1, scale: 8 },
        });
        m.addListener('click', () => openInfo(map, m, `
          <div style="background:#0f172a;color:#cbd5e1;padding:10px;border-radius:6px;font-family:sans-serif;">
            <b style="color:#ef4444">Fire Detection</b>
            ${f.isUpwind ? '<span style="background:#dc2626;color:#fff;font-size:0.6rem;padding:1px 5px;border-radius:3px;margin-left:6px">UPWIND</span>' : ''}
            <div style="margin-top:6px;font-size:0.85rem">
              <div>Distance: <b>${f.distanceKm?.toFixed(1)} km</b></div>
              <div>FRP: <b>${f.frp?.toFixed(0)} MW</b></div>
              <div>Confidence: <b>${f.confidence}</b></div>
              <div>Brightness: <b>${f.brightness?.toFixed(0)} K</b></div>
            </div>
          </div>
        `));
        allMarkers.push(m);
      }
    }

    // Earthquake markers
    if (layers.earthquakes && quakeData?.events) {
      for (const e of quakeData.events) {
        if (!e.lat || !e.lng) continue;
        const scale = Math.max(6, e.magnitude * 4);
        const m = new google.maps.Marker({
          position: { lat: e.lat, lng: e.lng },
          title: `M${e.magnitude} - ${e.place}`,
          icon: { path: google.maps.SymbolPath.CIRCLE, fillColor: '#8b5cf6', fillOpacity: 0.7, strokeColor: '#c4b5fd', strokeWeight: 1, scale },
          label: { text: `M${e.magnitude.toFixed(1)}`, color: '#fff', fontSize: '9px' },
        });
        m.addListener('click', () => openInfo(map, m, `
          <div style="background:#0f172a;color:#cbd5e1;padding:10px;border-radius:6px;min-width:180px;font-family:sans-serif;">
            <b style="color:#c4b5fd">M${e.magnitude.toFixed(1)} Earthquake</b>
            <div style="margin-top:6px;font-size:0.85rem">
              <div>Location: <b>${e.place}</b></div>
              <div>Depth: <b>${e.depthKm.toFixed(1)} km</b></div>
              <div>Distance: <b>${e.distanceKm.toFixed(0)} km</b></div>
              <div>Time: <b>${new Date(e.time).toLocaleString()}</b></div>
            </div>
          </div>
        `));
        allMarkers.push(m);
      }
    }

    // Oil/gas wells
    if (layers.wells && wellsData?.wells) {
      for (const w of wellsData.wells) {
        const m = new google.maps.Marker({
          position: { lat: w.lat, lng: w.lng },
          title: `${w.name} (${w.status})`,
          icon: { path: google.maps.SymbolPath.CIRCLE, fillColor: w.status === 'Active' ? '#78716c' : '#44403c', fillOpacity: 0.6, strokeColor: '#a8a29e', strokeWeight: 0.5, scale: 4 },
        });
        m.addListener('click', () => openInfo(map, m, `
          <div style="background:#0f172a;color:#cbd5e1;padding:10px;border-radius:6px;min-width:180px;font-family:sans-serif;">
            <b style="color:#f1f5f9">${w.name || 'Oil/Gas Well'}</b>
            <div style="margin-top:6px;font-size:0.85rem">
              <div>API: <b>${w.apiNumber}</b></div>
              <div>Type: <b>${w.wellType}</b></div>
              <div>Status: <b>${w.status}</b></div>
              <div>Operator: <b>${w.operator || 'Unknown'}</b></div>
              <div>Depth: <b>${w.depthFt ? w.depthFt + ' ft' : 'N/A'}</b></div>
            </div>
          </div>
        `));
        allMarkers.push(m);
      }
    }

    // Water quality (contaminated wells)
    if (layers.waterQuality && wqData?.wells) {
      for (const w of wqData.wells) {
        const hasExceedance = Object.values(w.parameters || {}).some(p => p.exceedsMCL);
        const m = new google.maps.Marker({
          position: { lat: w.lat, lng: w.lng },
          title: `${w.siteName}: ${hasExceedance ? 'EXCEEDS MCL' : 'Monitored'}`,
          icon: { path: google.maps.SymbolPath.CIRCLE, fillColor: hasExceedance ? '#ef4444' : '#f59e0b', fillOpacity: 0.8, strokeColor: '#fff', strokeWeight: 1, scale: 7 },
        });
        const paramHtml = Object.entries(w.parameters || {}).map(([name, p]) =>
          `<div>${name}: <b style="color:${p.exceedsMCL ? '#ef4444' : '#22c55e'}">${p.value} ${p.unit}</b>${p.exceedsMCL ? ' <span style="color:#ef4444;font-size:0.7rem">EXCEEDS MCL</span>' : ''}</div>`
        ).join('');
        m.addListener('click', () => openInfo(map, m, `
          <div style="background:#0f172a;color:#cbd5e1;padding:10px;border-radius:6px;min-width:200px;font-family:sans-serif;">
            <b style="color:#f1f5f9">${w.siteName}</b>
            <div style="margin-top:6px;font-size:0.85rem">${paramHtml || 'No data'}</div>
          </div>
        `));
        allMarkers.push(m);
      }
    }

    markersRef.current = allMarkers;

    // Cluster AQI markers only
    if (layers.aqi && aqiData?.readings && aqiData.readings.length > 10) {
      const aqiMarkers = allMarkers.slice(0, aqiData.readings.length);
      clustererRef.current = new MarkerClusterer({ markers: aqiMarkers, map });
    } else {
      allMarkers.forEach(m => m.setMap(map));
    }
  }, [layers, aqiData, firesData, quakeData, waterData, wellsData, wqData]);

  function openInfo(map: google.maps.Map, marker: google.maps.Marker, html: string) {
    activeInfoRef.current?.close();
    const iw = new google.maps.InfoWindow({ content: html });
    iw.open(map, marker);
    activeInfoRef.current = iw;
  }

  // ── Search ────────────────────────────────────────

  const handleSearch = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery || !mapInstanceRef.current) return;
    const service = new google.maps.places.PlacesService(mapInstanceRef.current);
    service.textSearch({ query: searchQuery, location: mapInstanceRef.current.getCenter()!, radius: 50000 }, (results, status) => {
      if (status === google.maps.places.PlacesServiceStatus.OK && results && results.length > 0) {
        setSearchError(null);
        mapInstanceRef.current!.setCenter(results[0].geometry!.location!);
        mapInstanceRef.current!.setZoom(12);
      } else {
        setSearchError('Location not found.');
      }
    });
  }, [searchQuery]);

  // ── Render ────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="h-[calc(100vh-150px)] flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-t-transparent border-brand-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-[calc(100vh-150px)] flex items-center justify-center">
        <div className="text-center p-8 bg-brand-bg-light rounded-lg shadow-xl max-w-md">
          <KeyIcon className="w-12 h-12 text-brand-primary mx-auto mb-4" />
          <h3 className="text-xl font-bold text-slate-100 mb-2">Google Maps API Key Required</h3>
          <p className="text-slate-400 mb-4 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-120px)] min-h-[500px] flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
          <MapIcon className="w-7 h-7 text-brand-primary" />
          Maps
        </h2>
      </div>

      <div className="flex-1 relative rounded-lg overflow-hidden shadow-lg">
        <div ref={mapRef} className="w-full h-full" />

        {/* Search bar */}
        <div className="absolute top-3 left-3 right-3 md:right-auto md:w-80 bg-brand-bg-light/90 backdrop-blur-sm p-2 rounded-lg shadow-xl border border-brand-secondary/50">
          <form onSubmit={handleSearch} className="flex gap-2">
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search location..."
              className="flex-1 p-2 bg-brand-bg-dark border border-brand-secondary rounded-md focus:outline-none focus:ring-2 focus:ring-brand-primary text-sm"
            />
            <button type="submit" className="p-2 bg-brand-primary text-white rounded-md hover:bg-sky-600 transition-colors">
              <SearchIcon className="w-4 h-4" />
            </button>
          </form>
          {searchError && <p className="text-red-400 text-xs mt-1">{searchError}</p>}
        </div>

        {/* Layer control panel */}
        <div className="absolute top-3 right-3 bg-brand-bg-light/90 backdrop-blur-sm rounded-lg shadow-xl border border-brand-secondary/50 w-48">
          <div className="p-2 border-b border-brand-secondary/50">
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Data Layers</h4>
          </div>
          <div className="p-2 space-y-1">
            {LAYER_CONFIG.map(l => (
              <label key={l.key} className="flex items-center gap-2 py-1 px-1 rounded hover:bg-brand-bg-lighter/50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={layers[l.key]}
                  onChange={e => setLayers(prev => ({ ...prev, [l.key]: e.target.checked }))}
                  className="w-3.5 h-3.5 rounded border-slate-500 text-brand-primary focus:ring-brand-primary focus:ring-offset-0"
                />
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: l.color }} />
                <span className="text-xs text-slate-300">{l.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Legend */}
        <div className="absolute bottom-3 left-3 bg-brand-bg-light/90 backdrop-blur-sm p-2 rounded-lg shadow-xl border border-brand-secondary/50">
          <div className="space-y-1">
            {[
              { label: 'Good (0-50)', color: '#22c55e' },
              { label: 'Moderate (51-100)', color: '#facc15' },
              { label: 'USG (101-150)', color: '#f97316' },
              { label: 'Unhealthy (151-200)', color: '#ef4444' },
              { label: 'Very Unhealthy (201-300)', color: '#a855f7' },
              { label: 'Hazardous (301+)', color: '#881337' },
            ].map(c => (
              <div key={c.label} className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: c.color }} />
                <span className="text-[10px] text-slate-400">{c.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Active layer count */}
        <div className="absolute bottom-3 right-3 bg-brand-bg-light/90 backdrop-blur-sm px-3 py-1.5 rounded-lg shadow-xl border border-brand-secondary/50">
          <span className="text-[10px] text-slate-400">
            {markersRef.current.length} markers
          </span>
        </div>
      </div>
    </div>
  );
};

export default MapView;

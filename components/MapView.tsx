import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MarkerClusterer } from '@googlemaps/markerclusterer';
import { MapIcon } from './icons/MapIcon';
import { KeyIcon } from './icons/KeyIcon';
import { SearchIcon } from './icons/SearchIcon';

declare global {
    interface AIStudio {
        hasSelectedApiKey: () => Promise<boolean>;
        openSelectKey: () => Promise<void>;
    }
    interface Window {
        aistudio?: AIStudio;
    }
}

const INGESTION_URL = 'http://localhost:3001/api';

interface SnapshotReading {
    stationId: string;
    stationName: string;
    lat: number;
    lng: number;
    county: string;
    aqi: number;
    pm25: number;
    pm10: number;
    o3: number;
    no2: number;
    so2: number;
    co: number;
    temperature: number;
    humidity: number;
    windSpeed: number;
    windDirection: number;
    source: string;
    rawSensorCount?: number;
    timestamp: string;
}

const ListIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
    <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
  </svg>
);

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

const aqiCategories = [
    { name: 'Good', range: '0-50', color: '#22c55e' },
    { name: 'Moderate', range: '51-100', color: '#facc15' },
    { name: 'Unhealthy for Sensitive', range: '101-150', color: '#f97316' },
    { name: 'Unhealthy', range: '151-200', color: '#ef4444' },
    { name: 'Very Unhealthy', range: '201-300', color: '#a855f7' },
    { name: 'Hazardous', range: '301+', color: '#881337' },
];

const mapStyles = [
  { "elementType": "geometry", "stylers": [{ "color": "#1e293b" }] },
  { "elementType": "labels.icon", "stylers": [{ "visibility": "off" }] },
  { "elementType": "labels.text.fill", "stylers": [{ "color": "#94a3b8" }] },
  { "elementType": "labels.text.stroke", "stylers": [{ "color": "#1e293b" }] },
  { "featureType": "administrative", "elementType": "geometry", "stylers": [{ "color": "#475569" }] },
  { "featureType": "administrative.country", "elementType": "labels.text.fill", "stylers": [{ "color": "#e2e8f0" }] },
  { "featureType": "administrative.land_parcel", "stylers": [{ "visibility": "off" }] },
  { "featureType": "administrative.locality", "elementType": "labels.text.fill", "stylers": [{ "color": "#e2e8f0" }] },
  { "featureType": "poi", "elementType": "labels.text.fill", "stylers": [{ "color": "#94a3b8" }] },
  { "featureType": "poi.park", "elementType": "geometry", "stylers": [{ "color": "#0f172a" }] },
  { "featureType": "road", "elementType": "geometry.fill", "stylers": [{ "color": "#334155" }] },
  { "featureType": "road", "elementType": "labels.text.fill", "stylers": [{ "color": "#94a3b8" }] },
  { "featureType": "road.arterial", "elementType": "geometry", "stylers": [{ "color": "#475569" }] },
  { "featureType": "road.highway", "elementType": "geometry", "stylers": [{ "color": "#0284c7" }] },
  { "featureType": "road.highway", "elementType": "labels.text.fill", "stylers": [{ "color": "#e2e8f0" }] },
  { "featureType": "road.highway.controlled_access", "elementType": "geometry", "stylers": [{ "color": "#0ea5e9" }] },
  { "featureType": "water", "elementType": "geometry", "stylers": [{ "color": "#0f172a" }] },
  { "featureType": "water", "elementType": "labels.text.fill", "stylers": [{ "color": "#475569" }] },
];

function buildInfoContent(r: SnapshotReading): string {
    const city = r.stationName.split('-')[0];
    const sensorLine = r.rawSensorCount
        ? `<p style="margin:0 0 4px;font-size:0.75rem;color:#64748b;">${r.rawSensorCount} PurpleAir sensors averaged</p>`
        : '';
    const sourceBadge = r.source === 'purpleair'
        ? '<span style="background:#7c3aed;color:#fff;font-size:0.6rem;padding:1px 5px;border-radius:3px;margin-left:6px;">LIVE</span>'
        : '<span style="background:#475569;color:#94a3b8;font-size:0.6rem;padding:1px 5px;border-radius:3px;margin-left:6px;">MOCK</span>';

    return `
        <div style="background:#0f172a;color:#cbd5e1;padding:12px;font-family:sans-serif;border-radius:6px;min-width:200px;">
            <h3 style="font-weight:bold;font-size:1rem;color:#f1f5f9;margin:0 0 2px;">${city}${sourceBadge}</h3>
            <p style="margin:0 0 8px;font-size:0.75rem;color:#64748b;">${r.county} County</p>
            ${sensorLine}
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 16px;font-size:0.875rem;">
                <div>AQI: <b style="color:${getAqiColor(r.aqi)}">${r.aqi}</b></div>
                <div>PM2.5: <b>${r.pm25.toFixed(1)}</b></div>
                <div>Temp: <b style="color:#f87171">${Math.round(r.temperature)}°F</b></div>
                <div>Humidity: <b style="color:#38bdf8">${Math.round(r.humidity)}%</b></div>
                <div>PM10: <b>${r.pm10.toFixed(1)}</b></div>
                <div>O₃: <b>${r.o3.toFixed(3)}</b></div>
            </div>
            <p style="margin:8px 0 0;font-size:0.7rem;color:#475569;border-top:1px solid #334155;padding-top:6px;">
                ${getAqiCategory(r.aqi)} · ${new Date(r.timestamp).toLocaleTimeString()}
            </p>
        </div>
    `;
}

const MapView: React.FC = () => {
    const mapRef = useRef<HTMLDivElement>(null);
    const mapInstanceRef = useRef<google.maps.Map | null>(null);
    const markerClustererRef = useRef<MarkerClusterer | null>(null);
    const activeInfoWindowRef = useRef<google.maps.InfoWindow | null>(null);

    const isScriptLoaded = useRef(false);
    const [isApiReady, setIsApiReady] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [apiKeySelected, setApiKeySelected] = useState(false);
    const [isLegendOpen, setIsLegendOpen] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchError, setSearchError] = useState<string | null>(null);
    const [readings, setReadings] = useState<SnapshotReading[]>([]);

    // Fetch live AQI data
    const fetchReadings = useCallback(async () => {
        try {
            const res = await fetch(`${INGESTION_URL}/aqi-snapshot`);
            if (!res.ok) throw new Error('Snapshot fetch failed');
            const data = await res.json();
            setReadings(data.readings || []);
        } catch (e) {
            console.error('Failed to fetch AQI snapshot for map:', e);
        }
    }, []);

    // Poll every 30s for updated readings
    useEffect(() => {
        fetchReadings();
        const interval = setInterval(fetchReadings, 30000);
        return () => clearInterval(interval);
    }, [fetchReadings]);

    const loadScript = useCallback(async () => {
        if (isScriptLoaded.current || window.google?.maps) {
            setIsApiReady(true);
            setIsLoading(false);
            return;
        }

        document.getElementById('google-maps-script')?.remove();

        try {
            const response = await fetch('http://localhost:3002/api/maps-config');
            if (!response.ok) throw new Error('Failed to fetch Google Maps API key from backend');
            const { apiKey } = await response.json();

            const script = document.createElement('script');
            script.id = 'google-maps-script';
            script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
            script.onload = () => {
                isScriptLoaded.current = true;
                setIsApiReady(true);
                setIsLoading(false);
                setError(null);
            };
            script.onerror = () => {
                setError('Google Maps failed to load. Check that the API key is valid and "Maps JavaScript API" is enabled.');
                setIsLoading(false);
                setApiKeySelected(false);
            };
            document.head.appendChild(script);
        } catch (error) {
            console.error('Error loading Google Maps:', error);
            setError('Failed to load Google Maps configuration. Ensure the backend is running and GOOGLE_MAPS_API_KEY is set in .env.');
            setIsLoading(false);
            setApiKeySelected(false);
        }
    }, []);

    useEffect(() => {
        setIsLoading(true);
        setError(null);
        setApiKeySelected(true);
        loadScript();
    }, [loadScript]);

    // Build markers from live readings
    useEffect(() => {
        if (!isApiReady || !mapRef.current || readings.length === 0) return;

        const map = mapInstanceRef.current || new window.google.maps.Map(mapRef.current, {
            center: { lat: 36.7378, lng: -119.7871 },
            zoom: 8,
            styles: mapStyles,
            disableDefaultUI: true,
            zoomControl: true,
        });
        mapInstanceRef.current = map;

        // Clear previous markers
        if (markerClustererRef.current) {
            markerClustererRef.current.clearMarkers();
        }

        const markers = readings.map(r => {
            const labelColor = r.aqi > 200 ? '#ffffff' : '#1e293b';

            const marker = new window.google.maps.Marker({
                position: { lat: r.lat, lng: r.lng },
                title: `${r.stationName} - AQI: ${r.aqi}`,
                icon: {
                    path: window.google.maps.SymbolPath.CIRCLE,
                    fillColor: getAqiColor(r.aqi),
                    fillOpacity: 1.0,
                    strokeColor: '#fff',
                    strokeWeight: 1.5,
                    scale: 14,
                },
                label: {
                    text: String(r.aqi),
                    color: labelColor,
                    fontSize: '12px',
                    fontWeight: 'bold',
                },
            });

            const infoWindow = new window.google.maps.InfoWindow({
                content: buildInfoContent(r),
            });

            marker.addListener('click', () => {
                if (activeInfoWindowRef.current) activeInfoWindowRef.current.close();
                infoWindow.open(map, marker);
                activeInfoWindowRef.current = infoWindow;
            });

            return marker;
        });

        markerClustererRef.current = new MarkerClusterer({ markers, map });

        map.addListener('click', () => {
            if (activeInfoWindowRef.current) {
                activeInfoWindowRef.current.close();
                activeInfoWindowRef.current = null;
            }
        });
    }, [isApiReady, readings]);

    const handleSearch = useCallback((e: React.FormEvent) => {
        e.preventDefault();
        if (!searchQuery || !mapInstanceRef.current) return;

        const service = new window.google.maps.places.PlacesService(mapInstanceRef.current);
        service.textSearch({ query: searchQuery, location: mapInstanceRef.current.getCenter(), radius: 50000 }, (results: any[], status: string) => {
            if (status === window.google.maps.places.PlacesServiceStatus.OK && results.length > 0) {
                setSearchError(null);
                const location = results[0].geometry.location;
                mapInstanceRef.current!.setCenter(location);
                mapInstanceRef.current!.setZoom(12);

                const infoWindow = new window.google.maps.InfoWindow({
                    content: `<div style="background:#0f172a;color:#cbd5e1;padding:8px;border-radius:4px;"><strong>${results[0].name}</strong><br>${results[0].formatted_address}</div>`
                });
                const marker = new window.google.maps.Marker({
                    map: mapInstanceRef.current!,
                    position: location,
                });
                infoWindow.open(mapInstanceRef.current!, marker);
            } else {
                setSearchError('Location not found. Try a different search term.');
            }
        });
    }, [searchQuery]);

    const renderContent = () => {
        if (isLoading) {
            return (
                <div className="flex items-center justify-center h-full bg-brand-bg-dark rounded-lg">
                    <div className="w-10 h-10 border-4 border-t-transparent border-brand-primary rounded-full animate-spin"></div>
                </div>
            );
        }

        if (!apiKeySelected || error) {
            return (
                <div className="flex items-center justify-center h-full bg-brand-bg-dark rounded-lg">
                    <div className="text-center p-8 bg-brand-bg-light rounded-lg shadow-xl max-w-md mx-auto">
                        <KeyIcon className="w-12 h-12 text-brand-primary mx-auto mb-4" />
                        <h3 className="text-xl font-bold text-slate-100 mb-2">Google Maps API Key Required</h3>
                        <p className="text-slate-400 mb-6">
                            Add <code className="bg-brand-bg-dark px-2 py-1 rounded text-sky-400">GOOGLE_MAPS_API_KEY</code> to your <code className="bg-brand-bg-dark px-2 py-1 rounded text-sky-400">.env</code> file and run <code className="bg-brand-bg-dark px-2 py-1 rounded text-sky-400">docker compose up -d analytics</code>.
                        </p>
                        {error && <p className="bg-red-900/50 border border-red-700 text-red-200 p-3 rounded-md mb-4 text-sm">{error}</p>}
                    </div>
                </div>
            );
        }

        return (
            <div className="relative w-full h-full rounded-lg overflow-hidden shadow-lg">
                <div ref={mapRef} className="w-full h-full" />
                <div className="absolute top-4 left-4 right-4 md:right-auto md:w-96 bg-brand-bg-light/90 backdrop-blur-sm p-3 rounded-lg shadow-xl border border-brand-secondary/50">
                    <form onSubmit={handleSearch} className="flex gap-2">
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search for a location..."
                            className="flex-1 p-2 bg-brand-bg-dark border border-brand-secondary rounded-md focus:outline-none focus:ring-2 focus:ring-brand-primary text-sm"
                        />
                        <button type="submit" className="p-2 bg-brand-primary text-white rounded-md hover:bg-sky-600 transition-colors">
                            <SearchIcon className="w-5 h-5" />
                        </button>
                    </form>
                    {searchError && <p className="text-red-400 text-xs mt-2">{searchError}</p>}
                </div>
                <div className="absolute bottom-4 left-4 bg-brand-bg-light/90 backdrop-blur-sm p-3 rounded-lg shadow-xl border border-brand-secondary/50">
                    <button onClick={() => setIsLegendOpen(!isLegendOpen)} className="flex items-center justify-between w-full font-bold text-slate-200">
                        {isLegendOpen ? 'Hide Legend' : 'Show Legend'}
                        <ListIcon className="w-5 h-5 ml-2"/>
                    </button>
                    {isLegendOpen && (
                        <div className="mt-3 space-y-2">
                            <h4 className="font-semibold text-sm text-slate-300 border-b border-brand-secondary pb-1 mb-2">AQI Legend</h4>
                            {aqiCategories.map(cat => (
                                <div key={cat.name} className="flex items-center gap-3">
                                    <div className="w-4 h-4 rounded-full" style={{ backgroundColor: cat.color }}></div>
                                    <span className="text-xs text-slate-300">{cat.name} ({cat.range})</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div className="h-[calc(100vh-150px)] min-h-[500px]">
            <h2 className="text-3xl font-bold text-slate-100 mb-4 flex items-center gap-3">
                <MapIcon className="w-8 h-8 text-brand-primary"/>
                Interactive Air Quality Map
            </h2>
            {renderContent()}
        </div>
    );
};

export default MapView;

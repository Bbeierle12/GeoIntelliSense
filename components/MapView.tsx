import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MarkerClusterer } from '@googlemaps/markerclusterer';
import { dashboardData, cityLocations } from '../data/dashboardData';
import { MapIcon } from './icons/MapIcon';
import { KeyIcon } from './icons/KeyIcon';
import { SearchIcon } from './icons/SearchIcon';
import { getAqiColor, AQI_CATEGORIES } from '../constants/aqi';
import { SAN_JOAQUIN_VALLEY_CENTER, DEFAULT_CITY_ZOOM, SEARCH_RADIUS_METERS } from '../constants/locations';
import { SEARCH_INPUT, VALIDATION_ERRORS } from '../constants/validation';

// Define AIStudio interface within the global scope to resolve type conflicts.
// Extend the Window interface to include google.maps and aistudio.
declare global {
    interface AIStudio {
        hasSelectedApiKey: () => Promise<boolean>;
        openSelectKey: () => Promise<void>;
    }

    interface Window {
        google: any; // Google Maps API dynamically loaded at runtime
        aistudio?: AIStudio;
    }
}

const ListIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <line x1="8" y1="6" x2="21" y2="6" />
    <line x1="8" y1="12" x2="21" y2="12" />
    <line x1="8" y1="18" x2="21" y2="18" />
    <line x1="3" y1="6" x2="3.01" y2="6" />
    <line x1="3" y1="12" x2="3.01" y2="12" />
    <line x1="3" y1="18" x2="3.01" y2="18" />
  </svg>
);


const generateSparkline = (data: { month: string; avgAqi: number }[]): string => {
    if (!data || data.length < 2) return '';

    const width = 150;
    const height = 40;
    const padding = 2;
    
    const aqiValues = data.map(d => d.avgAqi);
    const minAqi = Math.min(...aqiValues);
    const maxAqi = Math.max(...aqiValues);
    const aqiRange = maxAqi - minAqi === 0 ? 1 : maxAqi - minAqi;

    const points = data.map((d, i) => {
        const x = (i / (data.length - 1)) * (width - 2 * padding) + padding;
        const y = (height - padding) - ((d.avgAqi - minAqi) / aqiRange) * (height - 2 * padding);
        return `${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(' ');

    const aqiColor = getAqiColor(aqiValues[aqiValues.length - 1]);

    return `
        <div style="margin-top: 10px; padding-top: 8px; border-top: 1px solid #334155;">
            <p style="font-size: 0.75rem; color: #9ca3af; margin: 0 0 4px 0; font-weight: 600;">12-Month AQI Trend</p>
            <svg viewBox="0 0 ${width} ${height}" style="width: 100%; height: auto;">
                <polyline
                    fill="none"
                    stroke="${aqiColor}"
                    stroke-width="1.5"
                    points="${points}"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                />
            </svg>
            <div style="display: flex; justify-content: space-between; font-size: 0.65rem; color: #64748b; margin-top: 2px;">
                <span>Min: ${minAqi}</span>
                <span>Max: ${maxAqi}</span>
            </div>
        </div>
    `;
};

const mapStyles = [
  {
    "elementType": "geometry",
    "stylers": [
      {
        "color": "#1e293b"
      }
    ]
  },
  {
    "elementType": "labels.icon",
    "stylers": [
      {
        "visibility": "off"
      }
    ]
  },
  {
    "elementType": "labels.text.fill",
    "stylers": [
      {
        "color": "#94a3b8"
      }
    ]
  },
  {
    "elementType": "labels.text.stroke",
    "stylers": [
      {
        "color": "#1e293b"
      }
    ]
  },
  {
    "featureType": "administrative",
    "elementType": "geometry",
    "stylers": [
      {
        "color": "#475569"
      }
    ]
  },
  {
    "featureType": "administrative.country",
    "elementType": "labels.text.fill",
    "stylers": [
      {
        "color": "#e2e8f0"
      }
    ]
  },
  {
    "featureType": "administrative.land_parcel",
    "stylers": [
      {
        "visibility": "off"
      }
    ]
  },
  {
    "featureType": "administrative.locality",
    "elementType": "labels.text.fill",
    "stylers": [
      {
        "color": "#e2e8f0"
      }
    ]
  },
  {
    "featureType": "poi",
    "elementType": "labels.text.fill",
    "stylers": [
      {
        "color": "#94a3b8"
      }
    ]
  },
  {
    "featureType": "poi.park",
    "elementType": "geometry",
    "stylers": [
      {
        "color": "#0f172a"
      }
    ]
  },
  {
    "featureType": "poi.park",
    "elementType": "labels.text.fill",
    "stylers": [
      {
        "color": "#64748b"
      }
    ]
  },
  {
    "featureType": "poi.park",
    "elementType": "labels.text.stroke",
    "stylers": [
      {
        "color": "#0f172a"
      }
    ]
  },
  {
    "featureType": "road",
    "elementType": "geometry.fill",
    "stylers": [
      {
        "color": "#334155"
      }
    ]
  },
  {
    "featureType": "road",
    "elementType": "labels.text.fill",
    "stylers": [
      {
        "color": "#94a3b8"
      }
    ]
  },
  {
    "featureType": "road.arterial",
    "elementType": "geometry",
    "stylers": [
      {
        "color": "#475569"
      }
    ]
  },
  {
    "featureType": "road.highway",
    "elementType": "geometry",
    "stylers": [
      {
        "color": "#0284c7"
      }
    ]
  },
  {
    "featureType": "road.highway",
    "elementType": "labels.text.fill",
    "stylers": [
      {
        "color": "#e2e8f0"
      }
    ]
  },
  {
    "featureType": "road.highway.controlled_access",
    "elementType": "geometry",
    "stylers": [
      {
        "color": "#0ea5e9"
      }
    ]
  },
  {
    "featureType": "road.local",
    "elementType": "labels.text.fill",
    "stylers": [
      {
        "color": "#64748b"
      }
    ]
  },
  {
    "featureType": "transit",
    "elementType": "labels.text.fill",
    "stylers": [
      {
        "color": "#94a3b8"
      }
    ]
  },
  {
    "featureType": "water",
    "elementType": "geometry",
    "stylers": [
      {
        "color": "#0f172a"
      }
    ]
  },
  {
    "featureType": "water",
    "elementType": "labels.text.fill",
    "stylers": [
      {
        "color": "#475569"
      }
    ]
  }
];

const MapView: React.FC = () => {
    const mapRef = useRef<HTMLDivElement>(null);
    const mapInstanceRef = useRef<any>(null);
    const markerClustererRef = useRef<MarkerClusterer | null>(null);
    const infoWindowsRef = useRef<Map<string, any>>(new Map());
    const activeInfoWindowRef = useRef<any>(null);
    
    const isScriptLoaded = useRef(false);
    const [isApiReady, setIsApiReady] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [apiKeySelected, setApiKeySelected] = useState(false);
    const [isLegendOpen, setIsLegendOpen] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchError, setSearchError] = useState<string | null>(null);

    const loadScript = useCallback(() => {
        if (isScriptLoaded.current || window.google?.maps) {
            setIsApiReady(true);
            setIsLoading(false);
            return;
        }
        
        document.getElementById('google-maps-script')?.remove();

        const script = document.createElement('script');
        script.id = 'google-maps-script';
        script.src = `https://maps.googleapis.com/maps/api/js?key=${process.env.API_KEY}&libraries=places`;
        script.onload = () => {
            isScriptLoaded.current = true;
            setIsApiReady(true);
            setIsLoading(false);
            setError(null);
        };
        script.onerror = () => {
            setError('Google Maps failed to load. The selected API key is invalid, not enabled for the "Maps JavaScript API", or has restrictions. Please select a different key or check its configuration in the Google Cloud Console.');
            setIsLoading(false);
            setApiKeySelected(false);
        };
        document.head.appendChild(script);
    }, []);

    const checkAndLoadMap = useCallback(async (isAfterSelection: boolean = false) => {
        setIsLoading(true);
        setError(null);

        if (!window.aistudio) {
            setError("AI Studio environment not detected. Cannot select API key for Maps.");
            setIsLoading(false);
            return;
        }

        const hasKey = isAfterSelection || await window.aistudio.hasSelectedApiKey();
        setApiKeySelected(hasKey);
        
        if (hasKey) {
            if (isAfterSelection) {
                // Short delay to mitigate race condition where process.env.API_KEY might not be updated instantly.
                await new Promise(resolve => setTimeout(resolve, 250));
            }
            loadScript();
        } else {
            setIsLoading(false);
        }
    }, [loadScript]);

    useEffect(() => {
        checkAndLoadMap();
    }, [checkAndLoadMap]);

    useEffect(() => {
        if (isApiReady && mapRef.current) {
            const initializeMap = (
                center: { lat: number; lng: number },
                zoom: number,
                userLocation?: { lat: number; lng: number }
            ) => {
                const map = new window.google.maps.Map(mapRef.current!, {
                    center,
                    zoom,
                    styles: mapStyles,
                    disableDefaultUI: true,
                    zoomControl: true,
                });
                mapInstanceRef.current = map;
                
                // Clear previous clusterer and info windows
                if (markerClustererRef.current) {
                    markerClustererRef.current.clearMarkers();
                }
                infoWindowsRef.current.clear();

                if (userLocation) {
                    new window.google.maps.Marker({
                        position: userLocation,
                        map: map,
                        title: 'Your Location',
                        icon: {
                            path: window.google.maps.SymbolPath.CIRCLE,
                            fillColor: '#4285F4',
                            fillOpacity: 1,
                            strokeColor: '#ffffff',
                            strokeWeight: 2,
                            scale: 8,
                        },
                    });
                }

                const markers = cityLocations.map(city => {
                    const cityData = dashboardData[city];
                    if (cityData && 'coords' in cityData && 'currentAqi' in cityData && 'currentWeather' in cityData) {
                        const aqiValue = cityData.currentAqi.aqi;
                        const labelColor = aqiValue > 200 ? '#ffffff' : '#1e293b';

                        const marker = new window.google.maps.Marker({
                            position: cityData.coords,
                            // NOTE: map property is not set. Clusterer will handle placing it.
                            title: `${city} - AQI: ${aqiValue}`,
                            icon: {
                                path: window.google.maps.SymbolPath.CIRCLE,
                                fillColor: getAqiColor(aqiValue),
                                fillOpacity: 1.0,
                                strokeColor: '#fff',
                                strokeWeight: 1.5,
                                scale: 14,
                            },
                            label: {
                                text: String(aqiValue),
                                color: labelColor,
                                fontSize: '12px',
                                fontWeight: 'bold',
                            }
                        });
                        
                        const historicalAqiData = ('historicalAqi' in cityData && Array.isArray((cityData as any).historicalAqi)) 
                            ? (cityData as any).historicalAqi 
                            : [];
                        const sparklineHtml = generateSparkline(historicalAqiData);

                        const infoWindow = new window.google.maps.InfoWindow({
                            content: `
                                <div style="background-color: #0f172a; color: #cbd5e1; padding: 10px; font-family: sans-serif; border-radius: 4px; min-width: 160px;">
                                    <h3 style="font-weight: bold; font-size: 1rem; color: #f1f5f9; margin: 0 0 6px 0;">${city}</h3>
                                    <p style="margin: 0 0 4px 0; font-size: 0.875rem;">Current AQI: 
                                        <span style="font-weight: 600; color: ${getAqiColor(cityData.currentAqi.aqi)};">
                                            ${cityData.currentAqi.aqi}
                                        </span>
                                    </p>
                                    <p style="margin: 0 0 4px 0; font-size: 0.875rem;">Temperature: 
                                        <span style="font-weight: 600; color: #f87171;">
                                            ${cityData.currentWeather.temp}°F
                                        </span>
                                    </p>
                                    <p style="margin: 0; font-size: 0.875rem;">Humidity: 
                                        <span style="font-weight: 600; color: #38bdf8;">
                                            ${cityData.currentWeather.humidity}%
                                        </span>
                                    </p>
                                    ${sparklineHtml}
                                </div>
                            `,
                        });

                        infoWindowsRef.current.set(city, infoWindow);

                        marker.addListener('click', () => {
                            if (activeInfoWindowRef.current) {
                                activeInfoWindowRef.current.close();
                            }
                            infoWindow.open(map, marker);
                            activeInfoWindowRef.current = infoWindow;
                        });

                        return marker;
                    }
                    return null;
                }).filter((marker): marker is any => marker !== null);

                // Add a marker clusterer to manage the markers.
                markerClustererRef.current = new MarkerClusterer({ markers, map });
                
                map.addListener('click', () => {
                    if (activeInfoWindowRef.current) {
                        activeInfoWindowRef.current.close();
                        activeInfoWindowRef.current = null;
                    }
                });
            };

            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(
                    (position) => {
                        const userCoords = {
                            lat: position.coords.latitude,
                            lng: position.coords.longitude,
                        };
                        initializeMap(userCoords, 10, userCoords);
                    },
                    (error) => {
                        console.warn(`Geolocation error: ${error.message}. Defaulting to San Joaquin Valley center.`);
                        initializeMap(SAN_JOAQUIN_VALLEY_CENTER, 8);
                    }
                );
            } else {
                 console.warn('Geolocation is not supported by this browser. Defaulting to San Joaquin Valley center.');
                 initializeMap(SAN_JOAQUIN_VALLEY_CENTER, 8);
            }
        }
    // cityLocations and dashboardData are static imports and don't need to be in dependencies
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isApiReady]);

    const handleSelectKey = async () => {
        if (!window.aistudio) return;
        try {
            await window.aistudio.openSelectKey();
            checkAndLoadMap(true);
        } catch (e) {
            console.error("Error opening select key dialog", e);
            setError("Could not open the API key selection dialog.");
        }
    };
    
    const handleSearch = useCallback((e: React.FormEvent) => {
        e.preventDefault();

        // Input validation
        if (!searchQuery || !mapInstanceRef.current) {
            setSearchError(VALIDATION_ERRORS.EMPTY_INPUT);
            return;
        }

        const trimmedQuery = searchQuery.trim();

        if (trimmedQuery.length < SEARCH_INPUT.MIN_LENGTH) {
            setSearchError(VALIDATION_ERRORS.TOO_SHORT(SEARCH_INPUT.MIN_LENGTH));
            return;
        }

        if (trimmedQuery.length > SEARCH_INPUT.MAX_LENGTH) {
            setSearchError(VALIDATION_ERRORS.TOO_LONG(SEARCH_INPUT.MAX_LENGTH));
            return;
        }

        // Clear previous error
        setSearchError(null);

        const service = new window.google.maps.places.PlacesService(mapInstanceRef.current);
        service.textSearch(
            {
                query: trimmedQuery,
                location: mapInstanceRef.current.getCenter() ?? undefined,
                radius: SEARCH_RADIUS_METERS
            },
            (results: any[] | null, status: any) => {
                if (status === window.google.maps.places.PlacesServiceStatus.OK && results && results.length > 0) {
                    const result = results[0];
                    if (!result?.geometry?.location) {
                        setSearchError(VALIDATION_ERRORS.INVALID_DATA);
                        return;
                    }

                    const location = result.geometry.location;
                    mapInstanceRef.current?.setCenter(location);
                    mapInstanceRef.current?.setZoom(DEFAULT_CITY_ZOOM);

                    const infoWindow = new window.google.maps.InfoWindow({
                        content: `<strong>${result.name || 'Location'}</strong><br>${result.formatted_address || ''}`
                    });
                    const marker = new window.google.maps.Marker({
                        map: mapInstanceRef.current ?? undefined,
                        position: location,
                    });
                    infoWindow.open(mapInstanceRef.current ?? undefined, marker);

                } else {
                    setSearchError('Location not found. Please try a different search term.');
                }
            }
        );

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
                            To view the interactive map, you need to select a Google Cloud API key with the "Maps JavaScript API" enabled. This app may incur charges against your selected billing project.
                            <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline ml-1">Learn about billing.</a>
                        </p>
                        {error && <p className="bg-red-900/50 border border-red-700 text-red-200 p-3 rounded-md mb-4 text-sm">{error}</p>}
                        <button
                            onClick={handleSelectKey}
                            className="w-full py-2 px-4 bg-brand-primary text-white font-semibold rounded-md hover:bg-sky-600 transition-colors flex items-center justify-center gap-2"
                        >
                            <KeyIcon className="w-5 h-5"/>
                            Select API Key
                        </button>
                    </div>
                </div>
            );
        }

        return (
            <div className="relative w-full h-full rounded-lg overflow-hidden shadow-lg" role="region" aria-label="Interactive Air Quality Map">
                <div ref={mapRef} className="w-full h-full" aria-label="Air quality map showing San Joaquin Valley locations" />
                 <div className="absolute top-4 left-4 right-4 md:right-auto md:w-96 bg-brand-bg-light/90 backdrop-blur-sm p-3 rounded-lg shadow-xl border border-brand-secondary/50">
                     <form onSubmit={handleSearch} className="flex gap-2" role="search">
                        <label htmlFor="map-search" className="sr-only">
                            Search for a location on the map
                        </label>
                        <input
                            id="map-search"
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search for a location on the map..."
                            className="flex-1 p-2 bg-brand-bg-dark border border-brand-secondary rounded-md focus:outline-none focus:ring-2 focus:ring-brand-primary text-sm"
                            aria-describedby={searchError ? "search-error" : undefined}
                        />
                         <button type="submit" className="p-2 bg-brand-primary text-white rounded-md hover:bg-sky-600 transition-colors" aria-label="Search">
                            <SearchIcon className="w-5 h-5" aria-hidden="true" />
                        </button>
                    </form>
                     {searchError && <p id="search-error" className="text-red-400 text-xs mt-2" role="alert">{searchError}</p>}
                </div>
                <div className="absolute bottom-4 left-4 bg-brand-bg-light/90 backdrop-blur-sm p-3 rounded-lg shadow-xl border border-brand-secondary/50">
                    <button
                        onClick={() => setIsLegendOpen(!isLegendOpen)}
                        className="flex items-center justify-between w-full font-bold text-slate-200"
                        aria-expanded={isLegendOpen}
                        aria-controls="aqi-legend"
                        aria-label={isLegendOpen ? 'Hide AQI Legend' : 'Show AQI Legend'}
                    >
                        <span>{isLegendOpen ? 'Hide Legend' : 'Show Legend'}</span>
                        <ListIcon className="w-5 h-5 ml-2" aria-hidden="true" />
                    </button>
                     {isLegendOpen && (
                        <div id="aqi-legend" className="mt-3 space-y-2" role="region" aria-label="Air Quality Index Legend">
                            <h4 className="font-semibold text-sm text-slate-300 border-b border-brand-secondary pb-1 mb-2">AQI Legend</h4>
                            {AQI_CATEGORIES.map(cat => (
                                <div key={cat.name} className="flex items-center gap-3">
                                    <div className="w-4 h-4 rounded-full" style={{ backgroundColor: cat.color }} aria-hidden="true"></div>
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
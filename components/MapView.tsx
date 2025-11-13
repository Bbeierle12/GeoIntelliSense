import React, { useState, useEffect, useRef, useCallback } from 'react';
import { dashboardData, cityLocations } from '../data/dashboardData';
import { MapIcon } from './icons/MapIcon';
import { KeyIcon } from './icons/KeyIcon';

// FIX: Define AIStudio interface within the global scope to resolve type conflicts.
// Extend the Window interface to include google.maps and aistudio.
declare global {
    interface AIStudio {
        hasSelectedApiKey: () => Promise<boolean>;
        openSelectKey: () => Promise<void>;
    }

    interface Window {
        google: any;
        aistudio?: AIStudio;
    }
}

const getAqiColor = (aqi: number) => {
    if (aqi <= 50) return '#22c55e'; // green-500
    if (aqi <= 100) return '#facc15'; // yellow-400
    if (aqi <= 150) return '#f97316'; // orange-500
    if (aqi <= 200) return '#ef4444'; // red-500
    if (aqi <= 300) return '#a855f7'; // purple-500
    return '#881337'; // maroon-500 (custom)
}

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
    { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
    { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
    { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
    {
      featureType: "administrative.locality",
      elementType: "labels.text.fill",
      stylers: [{ color: "#d59563" }],
    },
    {
      featureType: "poi",
      elementType: "labels.text.fill",
      stylers: [{ color: "#d59563" }],
    },
    {
      featureType: "poi.park",
      elementType: "geometry",
      stylers: [{ color: "#263c3f" }],
    },
    {
      featureType: "poi.park",
      elementType: "labels.text.fill",
      stylers: [{ color: "#6b9a76" }],
    },
    {
      featureType: "road",
      elementType: "geometry",
      stylers: [{ color: "#38414e" }],
    },
    {
      featureType: "road",
      elementType: "geometry.stroke",
      stylers: [{ color: "#212a37" }],
    },
    {
      featureType: "road",
      elementType: "labels.text.fill",
      stylers: [{ color: "#9ca5b3" }],
    },
    {
      featureType: "road.highway",
      elementType: "geometry",
      stylers: [{ color: "#746855" }],
    },
    {
      featureType: "road.highway",
      elementType: "geometry.stroke",
      stylers: [{ color: "#1f2835" }],
    },
    {
      featureType: "road.highway",
      elementType: "labels.text.fill",
      stylers: [{ color: "#f3d19c" }],
    },
    {
      featureType: "transit",
      elementType: "geometry",
      stylers: [{ color: "#2f3948" }],
    },
    {
      featureType: "transit.station",
      elementType: "labels.text.fill",
      stylers: [{ color: "#d59563" }],
    },
    {
      featureType: "water",
      elementType: "geometry",
      stylers: [{ color: "#17263c" }],
    },
    {
      featureType: "water",
      elementType: "labels.text.fill",
      stylers: [{ color: "#515c6d" }],
    },
    {
      featureType: "water",
      elementType: "labels.text.stroke",
      stylers: [{ color: "#17263c" }],
    },
];

const MapView: React.FC = () => {
    const mapRef = useRef<HTMLDivElement>(null);
    const isScriptLoaded = useRef(false);
    const [isApiReady, setIsApiReady] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [apiKeySelected, setApiKeySelected] = useState(false);

    const loadScript = useCallback(() => {
        if (isScriptLoaded.current || window.google?.maps) {
            setIsApiReady(true);
            setIsLoading(false);
            return;
        }
        
        // Remove potentially failed script to allow retry
        document.getElementById('google-maps-script')?.remove();

        const script = document.createElement('script');
        script.id = 'google-maps-script';
        script.src = `https://maps.googleapis.com/maps/api/js?key=${process.env.API_KEY}`;
        script.onload = () => {
            isScriptLoaded.current = true;
            setIsApiReady(true);
            setIsLoading(false);
            setError(null);
        };
        script.onerror = () => {
            setError('Google Maps failed to load. The selected API key may be invalid or not enabled for the "Maps JavaScript API". Please select a different key.');
            setIsLoading(false);
            setApiKeySelected(false); // Allow user to try again
        };
        document.head.appendChild(script);
    }, []);

    const checkAndLoadMap = useCallback(async () => {
        setIsLoading(true);
        setError(null);

        if (!window.aistudio) {
            setError("AI Studio environment not detected. Cannot select API key for Maps.");
            setIsLoading(false);
            return;
        }

        const hasKey = await window.aistudio.hasSelectedApiKey();
        setApiKeySelected(hasKey);
        
        if (hasKey) {
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
            const sanJoaquinValleyCenter = { lat: 36.7378, lng: -119.7871 };
            const map = new window.google.maps.Map(mapRef.current, {
                center: sanJoaquinValleyCenter,
                zoom: 8,
                styles: mapStyles,
                disableDefaultUI: true,
                zoomControl: true,
            });

            let activeInfoWindow: any = null;

            cityLocations.forEach(city => {
                const cityData = dashboardData[city];
                if ('coords' in cityData && 'currentAqi' in cityData && 'currentWeather' in cityData) {
                    const aqiValue = cityData.currentAqi.aqi;

                    const marker = new window.google.maps.Marker({
                        position: cityData.coords,
                        map: map,
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
                            color: '#1e293b',
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

                    marker.addListener('click', () => {
                        if (activeInfoWindow) {
                            activeInfoWindow.close();
                        }
                        infoWindow.open(map, marker);
                        activeInfoWindow = infoWindow;
                    });
                }
            });
             map.addListener('click', () => {
                if (activeInfoWindow) {
                    activeInfoWindow.close();
                    activeInfoWindow = null;
                }
            });
        }
    }, [isApiReady]);

    const handleSelectKey = async () => {
        if (!window.aistudio) return;
        try {
            await window.aistudio.openSelectKey();
            // After dialog closes, re-run the check and load process
            await checkAndLoadMap();
        } catch (e) {
            console.error("Error opening select key dialog", e);
            setError("Could not open the API key selection dialog.");
        }
    };

    if (isLoading) {
        return (
            <div className="h-full flex items-center justify-center bg-brand-bg-light rounded-lg">
                <div className="w-12 h-12 border-4 border-t-transparent border-brand-primary rounded-full animate-spin"></div>
            </div>
        );
    }

    if (!apiKeySelected) {
        return (
            <div className="h-full flex flex-col items-center justify-center p-4 text-center">
                <div className="bg-brand-bg-light p-8 rounded-lg shadow-lg max-w-md">
                    <KeyIcon className="w-16 h-16 mx-auto text-brand-primary mb-4" />
                    <h2 className="text-2xl font-bold text-slate-100">API Key Required for Google Maps</h2>
                    <p className="text-slate-400 mt-2 mb-6">
                        To display the interactive map, you need to select a Google Cloud API key that is enabled for the <strong>Maps JavaScript API</strong>.
                    </p>
                    {error && <p className="bg-red-900/50 text-red-200 p-3 rounded-md mb-4 text-sm">{error}</p>}
                    <button
                        onClick={handleSelectKey}
                        className="w-full py-3 bg-brand-primary text-white font-semibold rounded-md hover:bg-sky-600 transition-colors flex items-center justify-center gap-2"
                    >
                        <KeyIcon className="w-5 h-5" />
                        Select API Key
                    </button>
                     <p className="text-xs text-slate-500 mt-4">
                        A Gemini API key alone is not sufficient for this feature. 
                        For more information on billing, see the <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noopener noreferrer" className="underline hover:text-sky-400">documentation</a>.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col space-y-4">
             <div>
                <h2 className="text-3xl font-bold text-slate-100 flex items-center gap-2">
                    <MapIcon className="w-8 h-8"/>
                    Interactive Map
                </h2>
                <p className="text-slate-400">
                    Visualize real-time air quality data across the San Joaquin Valley. Click on a marker for details.
                </p>
            </div>
             <div className="flex-grow bg-brand-bg-light rounded-lg shadow-lg relative overflow-hidden">
                <div ref={mapRef} className="w-full h-full" />
            </div>
        </div>
    );
};

export default MapView;


import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    ResponsiveContainer,
    LineChart,
    ComposedChart,
    Bar,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
} from 'recharts';
import {
    getGroundedSearchResponse,
    getGroundedMapsResponse,
    getLowLatencyResponse,
    getDeepAnalysisResponse,
    getPredictiveAnalysisResponse,
    getWeatherForecastResponse
} from '../services/geminiService';
import { useApiStatus } from '../hooks/useApiStatus';
import type { AnalysisTool, GroundingChunk } from '../types';
import { LightbulbIcon } from './icons/LightbulbIcon';
import { SearchIcon } from './icons/SearchIcon';
import { MapIcon } from './icons/MapIcon';
import { SparklesIcon } from './icons/SparklesIcon';
import { TrendingUpIcon } from './icons/TrendingUpIcon';
import { CloudIcon } from './icons/CloudIcon';
import { dashboardData, cityLocations, LocationKey } from '../data/dashboardData';

const toolConfig = {
    quick: {
        name: 'Quick Insight',
        description: 'Fast response for simple questions. Powered by Gemini Flash-Lite.',
        icon: LightbulbIcon,
        placeholder: 'e.g., Define atmospheric river.'
    },
    search: {
        name: 'Web Search',
        description: 'Get up-to-date information from the web. Powered by Gemini Flash with Google Search.',
        icon: SearchIcon,
        placeholder: 'e.g., Latest news on California drought conditions.'
    },
    maps: {
        name: 'Local Info',
        description: 'Find location-based information. Powered by Gemini Flash with Google Maps.',
        icon: MapIcon,
        placeholder: 'e.g., Find air quality monitoring stations near Fresno.'
    },
    deep: {
        name: 'Deep Dive',
        description: 'For complex, multi-step reasoning. Powered by Gemini Pro with Thinking Mode.',
        icon: SparklesIcon,
        placeholder: 'e.g., Analyze the long-term impact of wildfires on SJV agriculture.'
    },
    predictive: {
        name: 'Predictive AQI',
        description: 'Forecast future air quality trends using historical data. Powered by Gemini Pro.',
        icon: TrendingUpIcon,
        placeholder: 'Select a location below to generate an AQI forecast.'
    },
    weather: {
        name: 'Weather Forecast',
        description: 'Forecast future temperature and precipitation. Powered by Gemini Pro.',
        icon: CloudIcon,
        placeholder: 'Select a location below to generate a weather forecast.'
    }
};

const parseMonthString = (monthStr: string): Date => {
    const [month, year] = monthStr.replace("'", "").split(' ');
    const monthIndex = new Date(Date.parse(month +" 1, 2012")).getMonth();
    return new Date(parseInt(`20${year}`), monthIndex);
};

const AnalysisView: React.FC = () => {
    const { isAvailable: hasGeminiKey, isLoading: isApiLoading, error: apiError } = useApiStatus();
    const [tool, setTool] = useState<AnalysisTool>('predictive');
    const [prompt, setPrompt] = useState('');
    const [customFactors, setCustomFactors] = useState('');
    const [result, setResult] = useState<string | null>(null);
    const [groundingChunks, setGroundingChunks] = useState<GroundingChunk[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [location, setLocation] = useState<{ latitude: number, longitude: number } | null>(null);
    const [predictiveLocation, setPredictiveLocation] = useState<Exclude<LocationKey, 'Valley Average'>>('Bakersfield');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');


    useEffect(() => {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                setLocation({
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                });
            },
            (err) => {
                console.warn(`Geolocation error: ${err.message}`);
                // Fallback to a location in San Joaquin Valley (Fresno)
                setLocation({ latitude: 36.7378, longitude: -119.7871 });
            }
        );
        
        // Set default date range for predictive tool to the last 12 months of available data.
        const sampleData = dashboardData['Bakersfield'].historicalAqi;
        if (sampleData.length > 0) {
            const lastMonth = parseMonthString(sampleData[sampleData.length - 1].month);
            const defaultStartDate = new Date(lastMonth);
            defaultStartDate.setMonth(defaultStartDate.getMonth() - 11);

            const formatToInput = (date: Date) => date.toISOString().slice(0, 7);
            setStartDate(formatToInput(defaultStartDate));
            setEndDate(formatToInput(lastMonth));
        }
    }, []);
    
    const predictiveChartData = useMemo(() => {
        if (!startDate || !endDate || !predictiveLocation) return [];

        const locData = dashboardData[predictiveLocation];
        if (!locData || !('historicalAqi' in locData) || !('historicalWeather' in locData)) return [];

        const start = new Date(startDate);
        const end = new Date(endDate);
        end.setMonth(end.getMonth() + 1); // Make end date inclusive

        const filteredAqi = locData.historicalAqi.filter(d => {
            const date = parseMonthString(d.month);
            return date >= start && date < end;
        });

        const filteredWeather = locData.historicalWeather.filter(d => {
            const date = parseMonthString(d.month);
            return date >= start && date < end;
        });

        const weatherMap = new Map(filteredWeather.map(d => [d.month, d]));

        return filteredAqi.map(aqiData => {
            // FIX: Explicitly cast the value from the map to avoid 'unknown' type error.
            // TypeScript struggles to infer the type from the dashboardData object.
            const weatherForMonth = weatherMap.get(aqiData.month) as { avgTemp: number; precipitation: number } | undefined;
            return {
                month: aqiData.month,
                avgAqi: aqiData.avgAqi,
                avgPm25: aqiData.avgPm25,
                avgTemp: weatherForMonth?.avgTemp,
                precipitation: weatherForMonth?.precipitation,
            };
        });
    }, [predictiveLocation, startDate, endDate]);


    const handleSubmit = useCallback(async () => {
        if (isLoading) return;
        const isForecastTool = tool === 'predictive' || tool === 'weather';
        if (!isForecastTool && !prompt) return;

        setIsLoading(true);
        setResult(null);
        setGroundingChunks([]);
        setError(null);

        try {
            switch (tool) {
                case 'quick':
                    setResult(await getLowLatencyResponse(prompt));
                    break;
                case 'search':
                    const searchRes = await getGroundedSearchResponse(prompt);
                    setResult(searchRes.text);
                    setGroundingChunks(searchRes.groundingChunks);
                    break;
                case 'maps':
                    if (!location) {
                        setError("Location not available. Please enable location services.");
                        setIsLoading(false);
                        return;
                    }
                    const mapsRes = await getGroundedMapsResponse(prompt, location);
                    setResult(mapsRes.text);
                    setGroundingChunks(mapsRes.groundingChunks);
                    break;
                case 'deep':
                    setResult(await getDeepAnalysisResponse(prompt));
                    break;
                case 'predictive':
                case 'weather':
                    if (new Date(startDate) > new Date(endDate)) {
                        setError("Start date cannot be after end date.");
                        setIsLoading(false);
                        return;
                    }

                    const locData = dashboardData[predictiveLocation];
                    if (!locData || !('historicalAqi' in locData) || !('historicalWeather' in locData)) {
                        setError(`No complete historical data found for ${predictiveLocation}.`);
                        setIsLoading(false);
                        return;
                    }

                    const start = new Date(startDate);
                    const end = new Date(endDate);
                    end.setMonth(end.getMonth() + 1); // Make end date inclusive
                    
                     const filteredWeather = locData.historicalWeather.filter(d => {
                        const date = parseMonthString(d.month);
                        return date >= start && date < end;
                    });
                    
                    if (filteredWeather.length === 0) {
                        setError("No historical weather data available for the selected date range.");
                        setIsLoading(false);
                        return;
                    }

                    if (tool === 'weather') {
                         const resultText = await getWeatherForecastResponse(
                            predictiveLocation,
                            filteredWeather,
                            customFactors,
                            startDate,
                            endDate
                        );
                        setResult(resultText);
                    } else { // 'predictive'
                        const filteredAqi = locData.historicalAqi.filter(d => {
                            const date = parseMonthString(d.month);
                            return date >= start && date < end;
                        });

                        if (filteredAqi.length === 0) {
                            setError("No historical AQI data available for the selected date range.");
                            setIsLoading(false);
                            return;
                        }

                        const resultText = await getPredictiveAnalysisResponse(
                            predictiveLocation,
                            filteredAqi,
                            filteredWeather,
                            customFactors,
                            startDate,
                            endDate
                        );
                        setResult(resultText);
                    }
                    break;
            }
        } catch (e: any) {
            setError(e.message || "An unexpected error occurred.");
        } finally {
            setIsLoading(false);
        }
    }, [prompt, isLoading, tool, location, predictiveLocation, customFactors, startDate, endDate]);

    const currentTool = toolConfig[tool];
    const isForecastTool = tool === 'predictive' || tool === 'weather';
    
    return (
        <div className="max-w-5xl mx-auto space-y-6">
            {/* Loading state announcement for screen readers */}
            <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
                {isLoading && <span>Loading analysis results...</span>}
                {error && <span>Error: {error}</span>}
                {result && <span>Analysis complete. Results are now available.</span>}
            </div>

            {!hasGeminiKey && (
                <div className="bg-yellow-900/30 border border-yellow-700/50 text-yellow-200 p-4 rounded-lg flex items-start gap-3">
                    <svg className="w-5 h-5 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    <div>
                        <p className="font-semibold">Backend Server Required</p>
                        <p className="text-sm mt-1">Start the backend server with <code className="bg-yellow-950 px-1.5 py-0.5 rounded">npm run server</code> and ensure <code className="bg-yellow-950 px-1.5 py-0.5 rounded">GEMINI_API_KEY</code> is configured in your <code className="bg-yellow-950 px-1.5 py-0.5 rounded">.env.local</code> file.</p>
                    </div>
                </div>
            )}
            <div>
                <h2 className="text-3xl font-bold text-slate-100">Advanced Analysis Tools</h2>
                <p className="text-slate-400">Select a tool to perform a specific type of analysis.</p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 md:gap-4" role="group" aria-label="Analysis tool selection">
                {(Object.keys(toolConfig) as AnalysisTool[]).map(key => {
                    const t = toolConfig[key];
                    return (
                        <button 
                            key={key} 
                            onClick={() => setTool(key)}
                            aria-pressed={tool === key}
                            aria-label={`Select ${t.name} analysis tool`}
                            title={t.description}
                            className={`p-4 rounded-lg text-left transition-all duration-200 flex flex-col focus:outline-none focus:ring-2 focus:ring-brand-primary focus:ring-offset-2 focus:ring-offset-brand-bg-dark ${tool === key ? 'bg-brand-primary text-white shadow-lg' : 'bg-brand-bg-light hover:bg-brand-bg-lighter'}`}>
                            <t.icon className="w-6 h-6 mb-2" aria-hidden="true"/>
                            <h3 className="font-semibold text-sm md:text-base">{t.name}</h3>
                        </button>
                    )
                })}
            </div>

            <div className="bg-brand-bg-light p-6 rounded-lg shadow-lg space-y-4">
                <div>
                    <h3 className="text-xl font-semibold flex items-center gap-2">
                        <currentTool.icon className="w-6 h-6 text-brand-primary"/>
                        {currentTool.name}
                    </h3>
                    <p className="text-slate-400 text-sm">{currentTool.description}</p>
                </div>
                 {isForecastTool ? (
                    <div className="space-y-4">
                        <div>
                            <label htmlFor="location-select" className="block text-sm font-medium text-slate-400 mb-2">
                                Select Location for Prediction:
                            </label>
                            <select
                                id="location-select"
                                value={predictiveLocation}
                                onChange={(e) => setPredictiveLocation(e.target.value as Exclude<LocationKey, 'Valley Average'>)}
                                className="w-full p-2 bg-brand-bg-dark border border-brand-secondary rounded-md focus:outline-none focus:ring-2 focus:ring-brand-primary"
                            >
                                {cityLocations.map(loc => (
                                    <option key={loc} value={loc}>{loc}</option>
                                ))}
                            </select>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                           <div>
                                <label htmlFor="start-date" className="block text-sm font-medium text-slate-400 mb-2">
                                    Historical Data Start Date:
                                </label>
                                <input
                                    type="month"
                                    id="start-date"
                                    value={startDate}
                                    onChange={(e) => setStartDate(e.target.value)}
                                    aria-describedby="date-format-hint"
                                    className="w-full p-2 bg-brand-bg-dark border border-brand-secondary rounded-md focus:outline-none focus:ring-2 focus:ring-brand-primary"
                                    disabled={isLoading}
                                />
                            </div>
                            <div>
                                <label htmlFor="end-date" className="block text-sm font-medium text-slate-400 mb-2">
                                    Historical Data End Date:
                                </label>
                                <input
                                    type="month"
                                    id="end-date"
                                    value={endDate}
                                    onChange={(e) => setEndDate(e.target.value)}
                                    aria-describedby="date-format-hint"
                                    className="w-full p-2 bg-brand-bg-dark border border-brand-secondary rounded-md focus:outline-none focus:ring-2 focus:ring-brand-primary"
                                    disabled={isLoading}
                                />
                            </div>
                        </div>
                        <span id="date-format-hint" className="sr-only">Format: Year-Month (YYYY-MM)</span>

                        {predictiveChartData.length > 0 && (
                            <div className="mt-4 pt-4 border-t border-brand-secondary">
                                <h4 className="text-lg font-semibold text-slate-300 mb-2">Data Preview for {predictiveLocation}</h4>
                                <div className={`grid grid-cols-1 ${tool === 'predictive' ? 'md:grid-cols-2' : ''} gap-4`}>
                                    {tool === 'predictive' && (
                                        <div className="bg-brand-bg-dark p-2 rounded-md">
                                            <h5 className="text-sm text-center text-slate-400 font-semibold mb-2">Air Quality</h5>
                                            <ResponsiveContainer width="100%" height={200}>
                                                <LineChart data={predictiveChartData} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
                                                    <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
                                                    <XAxis dataKey="month" stroke="#94a3b8" fontSize={12} />
                                                    <YAxis stroke="#94a3b8" fontSize={12} />
                                                    <Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155' }} labelStyle={{ color: '#cbd5e1' }} />
                                                    <Legend wrapperStyle={{fontSize: "12px"}}/>
                                                    <Line type="monotone" dataKey="avgAqi" stroke="#ef4444" name="AQI" strokeWidth={2}/>
                                                    <Line type="monotone" dataKey="avgPm25" stroke="#f97316" name="PM2.5" strokeWidth={2}/>
                                                </LineChart>
                                            </ResponsiveContainer>
                                        </div>
                                    )}
                                    <div className="bg-brand-bg-dark p-2 rounded-md">
                                        <h5 className="text-sm text-center text-slate-400 font-semibold mb-2">Weather</h5>
                                        <ResponsiveContainer width="100%" height={200}>
                                            <ComposedChart data={predictiveChartData} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
                                                <XAxis dataKey="month" stroke="#94a3b8" fontSize={12} />
                                                <YAxis yAxisId="left" stroke="#eab308" fontSize={12} />
                                                <YAxis yAxisId="right" orientation="right" stroke="#3b82f6" fontSize={12} />
                                                <Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155' }} labelStyle={{ color: '#cbd5e1' }} />
                                                <Legend wrapperStyle={{fontSize: "12px"}}/>
                                                <Bar yAxisId="right" dataKey="precipitation" fill="#3b82f6" name="Precip (in)" />
                                                <Line yAxisId="left" type="monotone" dataKey="avgTemp" stroke="#eab308" name="Temp (°F)" strokeWidth={2} />
                                            </ComposedChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>
                            </div>
                        )}

                         <div>
                            <label htmlFor="custom-factors" className="block text-sm font-medium text-slate-400 mb-2">
                                Custom Influencing Factors (Optional):
                            </label>
                            <textarea
                                id="custom-factors"
                                value={customFactors}
                                onChange={(e) => setCustomFactors(e.target.value)}
                                placeholder="e.g., Mention upcoming holiday traffic, planned agricultural burns, or unusual weather patterns like a heatwave."
                                className="w-full h-24 p-3 bg-brand-bg-dark border border-brand-secondary rounded-md focus:outline-none focus:ring-2 focus:ring-brand-primary resize-y"
                                disabled={isLoading}
                            />
                        </div>
                    </div>
                 ) : (
                    <textarea
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        placeholder={currentTool.placeholder}
                        className="w-full h-32 p-3 bg-brand-bg-dark border border-brand-secondary rounded-md focus:outline-none focus:ring-2 focus:ring-brand-primary resize-y"
                        disabled={isLoading}
                    />
                 )}
                <button
                    onClick={handleSubmit}
                    disabled={isLoading || (!isForecastTool && !prompt) || !hasGeminiKey}
                    className="w-full py-3 bg-brand-primary text-white font-semibold rounded-md hover:bg-sky-600 disabled:bg-slate-600 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                    title={!hasGeminiKey ? "Start the backend server to enable analysis" : ""}
                >
                    {isLoading ? (
                        <>
                            <div className="w-5 h-5 border-2 border-t-transparent border-white rounded-full animate-spin"></div>
                            Analyzing...
                        </>
                    ) : (
                        'Generate Analysis'
                    )}
                </button>
            </div>

            {error && <div className="bg-red-900/50 border border-red-700 text-red-200 p-4 rounded-lg">{error}</div>}
            
            {result && (
                <div className="bg-brand-bg-light p-6 rounded-lg shadow-lg space-y-4">
                    <h3 className="text-xl font-semibold">Analysis Result</h3>
                    <div className="prose prose-invert max-w-none text-slate-300 whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: result.replace(/\n/g, '<br />') }}></div>
                    {groundingChunks.length > 0 && (
                        <div className="pt-4 border-t border-brand-secondary">
                            <h4 className="font-semibold mb-2">Sources:</h4>
                            <ul className="list-disc list-inside space-y-1">
                                {groundingChunks.map((chunk, index) => (
                                    <li key={index}>
                                        {chunk.web && <a href={chunk.web.uri} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">{chunk.web.title}</a>}
                                        {chunk.maps && <a href={chunk.maps.uri} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">{chunk.maps.title}</a>}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default AnalysisView;

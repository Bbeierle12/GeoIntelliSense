import React, { useState, useEffect, useCallback } from 'react';
import { 
    getGroundedSearchResponse, 
    getGroundedMapsResponse, 
    getLowLatencyResponse, 
    getDeepAnalysisResponse,
    getPredictiveAnalysisResponse
} from '../services/geminiService';
import type { AnalysisTool, GroundingChunk } from '../types';
import { LightbulbIcon } from './icons/LightbulbIcon';
import { SearchIcon } from './icons/SearchIcon';
import { MapIcon } from './icons/MapIcon';
import { SparklesIcon } from './icons/SparklesIcon';
import { TrendingUpIcon } from './icons/TrendingUpIcon';
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
        name: 'Predictive Analysis',
        description: 'Forecast future air quality trends using historical data. Powered by Gemini Pro.',
        icon: TrendingUpIcon,
        placeholder: 'Select a location below and ask for a specific forecast, e.g., "Provide a detailed AQI forecast."'
    }
};

const AnalysisView: React.FC = () => {
    const [tool, setTool] = useState<AnalysisTool>('predictive');
    const [prompt, setPrompt] = useState('');
    const [result, setResult] = useState<string | null>(null);
    const [groundingChunks, setGroundingChunks] = useState<GroundingChunk[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [location, setLocation] = useState<{ latitude: number, longitude: number } | null>(null);
    const [predictiveLocation, setPredictiveLocation] = useState<Exclude<LocationKey, 'Valley Average'>>('Bakersfield');


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
    }, []);

    const handleSubmit = useCallback(async () => {
        if (isLoading) return;
        // The predictive tool doesn't require a prompt, but others do.
        if (tool !== 'predictive' && !prompt) return;

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
                    const locData = dashboardData[predictiveLocation];
                    if (!locData || !('historicalAqi' in locData)) {
                        setError(`No historical data found for ${predictiveLocation}.`);
                        return;
                    }
                    const resultText = await getPredictiveAnalysisResponse(
                        predictiveLocation,
                        locData.historicalAqi,
                        locData.historicalWeather
                    );
                    setResult(resultText);
                    break;
            }
        } catch (e: any) {
            setError(e.message || "An unexpected error occurred.");
        } finally {
            setIsLoading(false);
        }
    }, [prompt, isLoading, tool, location, predictiveLocation]);

    const currentTool = toolConfig[tool];
    
    return (
        <div className="max-w-5xl mx-auto space-y-6">
            <div>
                <h2 className="text-3xl font-bold text-slate-100">Advanced Analysis Tools</h2>
                <p className="text-slate-400">Select a tool to perform a specific type of analysis.</p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 md:gap-4">
                {(Object.keys(toolConfig) as AnalysisTool[]).map(key => {
                    const t = toolConfig[key];
                    return (
                        <button key={key} onClick={() => setTool(key)}
                            className={`p-4 rounded-lg text-left transition-all duration-200 flex flex-col ${tool === key ? 'bg-brand-primary text-white shadow-lg' : 'bg-brand-bg-light hover:bg-brand-bg-lighter'}`}>
                            <t.icon className="w-6 h-6 mb-2"/>
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
                 {tool === 'predictive' && (
                    <div className="space-y-2">
                        <label htmlFor="location-select" className="block text-sm font-medium text-slate-400">
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
                )}
                <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder={currentTool.placeholder}
                    className={`w-full h-24 p-3 bg-brand-bg-dark border border-brand-secondary rounded-md focus:outline-none focus:ring-2 focus:ring-brand-primary resize-y ${tool === 'predictive' ? 'h-24' : 'h-32'}`}
                    disabled={isLoading}
                />
                <button
                    onClick={handleSubmit}
                    disabled={isLoading || (tool !== 'predictive' && !prompt)}
                    className="w-full py-3 bg-brand-primary text-white font-semibold rounded-md hover:bg-sky-600 disabled:bg-slate-600 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
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
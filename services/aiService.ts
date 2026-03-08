
import type { GroundingChunk } from '../types';

const API_BASE_URL = import.meta.env.VITE_GATEWAY_URL
  ? `${import.meta.env.VITE_GATEWAY_URL}/api`
  : 'http://localhost:8080/api';

export const getChatResponse = async (message: string): Promise<string> => {
    try {
        const response = await fetch(`${API_BASE_URL}/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ message }),
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        return data.text;
    } catch (error) {
        console.error("Error in getChatResponse:", error);
        return "Sorry, I encountered an error. Please try again.";
    }
};

export const getGroundedSearchResponse = async (prompt: string): Promise<{ text: string, groundingChunks: GroundingChunk[] }> => {
    try {
        const response = await fetch(`${API_BASE_URL}/grounded-search`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ prompt }),
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        return { text: data.text, groundingChunks: data.groundingChunks };
    } catch (error) {
        console.error("Error in getGroundedSearchResponse:", error);
        return { text: "Failed to get a grounded response.", groundingChunks: [] };
    }
};

export const getGroundedMapsResponse = async (prompt: string, location: { latitude: number; longitude: number }): Promise<{ text: string, groundingChunks: GroundingChunk[] }> => {
    try {
        const response = await fetch(`${API_BASE_URL}/grounded-maps`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ prompt, location }),
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        return { text: data.text, groundingChunks: data.groundingChunks };
    } catch (error) {
        console.error("Error in getGroundedMapsResponse:", error);
        return { text: "Failed to get a map-grounded response. Please ensure location permissions are enabled.", groundingChunks: [] };
    }
};

export const getLowLatencyResponse = async (prompt: string): Promise<string> => {
    try {
        const response = await fetch(`${API_BASE_URL}/low-latency`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ prompt }),
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        return data.text;
    } catch (error) {
        console.error("Error in getLowLatencyResponse:", error);
        return "Failed to get a low-latency response.";
    }
};

export const getDeepAnalysisResponse = async (prompt: string): Promise<string> => {
    try {
        const response = await fetch(`${API_BASE_URL}/deep-analysis`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ prompt }),
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        return data.text;
    } catch (error) {
        console.error("Error in getDeepAnalysisResponse:", error);
        return "Failed to get a deep analysis response.";
    }
};

export const getPredictiveAnalysisResponse = async (
    locationName: string,
    historicalAqi: { month: string; avgAqi: number; avgPm25: number }[],
    historicalWeather: { month: string; avgTemp: number; precipitation: number }[],
    customFactors: string,
    startDate: string,
    endDate: string
): Promise<string> => {
    try {
        const response = await fetch(`${API_BASE_URL}/predictive-analysis`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                locationName,
                historicalAqi,
                historicalWeather,
                customFactors,
                startDate,
                endDate,
            }),
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        return data.text;
    } catch (error) {
        console.error("Error in getPredictiveAnalysisResponse:", error);
        return "Failed to get a predictive analysis response.";
    }
};

export const getWeatherForecastResponse = async (
    locationName: string,
    historicalWeather: { month: string; avgTemp: number; precipitation: number }[],
    customFactors: string,
    startDate: string,
    endDate: string
): Promise<string> => {
    try {
        const response = await fetch(`${API_BASE_URL}/weather-forecast`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                locationName,
                historicalWeather,
                customFactors,
                startDate,
                endDate,
            }),
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        return data.text;
    } catch (error) {
        console.error("Error in getWeatherForecastResponse:", error);
        return "Failed to get a weather forecast response.";
    }
};

/**
 * Gemini API Service (Backend Proxy)
 *
 * This service makes requests to the backend server instead of directly
 * calling the Gemini API. This keeps the API key secure on the server.
 */

import type { GroundingChunk } from '../types';

// Get API URL from environment variable
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

/**
 * Helper function to handle API errors
 */
function handleApiError(error: unknown, defaultMessage: string): string {
  if (error instanceof Error) {
    return error.message;
  }
  return defaultMessage;
}

/**
 * Chat message type for history
 */
interface ChatMessage {
  role: 'user' | 'model';
  parts: { text: string }[];
}

// Store chat history in memory
let chatHistory: ChatMessage[] = [];

/**
 * Get chat response from backend
 */
export const getChatResponse = async (message: string): Promise<string> => {
  try {
    const response = await fetch(`${API_URL}/api/gemini/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message,
        history: chatHistory
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to get chat response');
    }

    const data = await response.json();

    // Update chat history
    chatHistory.push(
      { role: 'user', parts: [{ text: message }] },
      { role: 'model', parts: [{ text: data.text }] }
    );

    return data.text;
  } catch (error) {
    console.error('Error in getChatResponse:', error);
    return handleApiError(error, 'Sorry, I encountered an error. Please try again.');
  }
};

/**
 * Get grounded search response (with web search)
 */
export const getGroundedSearchResponse = async (
  prompt: string
): Promise<{ text: string; groundingChunks: GroundingChunk[] }> => {
  try {
    const response = await fetch(`${API_URL}/api/gemini/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to get search response');
    }

    const data = await response.json();
    return {
      text: data.text,
      groundingChunks: data.groundingChunks || []
    };
  } catch (error) {
    console.error('Error in getGroundedSearchResponse:', error);
    return {
      text: handleApiError(error, 'Failed to get a grounded response.'),
      groundingChunks: []
    };
  }
};

/**
 * Get grounded maps response (with Google Maps integration)
 */
export const getGroundedMapsResponse = async (
  prompt: string,
  location: { latitude: number; longitude: number }
): Promise<{ text: string; groundingChunks: GroundingChunk[] }> => {
  try {
    const response = await fetch(`${API_URL}/api/gemini/maps`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt, location }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to get maps response');
    }

    const data = await response.json();
    return {
      text: data.text,
      groundingChunks: data.groundingChunks || []
    };
  } catch (error) {
    console.error('Error in getGroundedMapsResponse:', error);
    return {
      text: handleApiError(
        error,
        'Failed to get a map-grounded response. Please ensure location permissions are enabled.'
      ),
      groundingChunks: []
    };
  }
};

/**
 * Get low latency response (Quick Insight)
 */
export const getLowLatencyResponse = async (prompt: string): Promise<string> => {
  try {
    const response = await fetch(`${API_URL}/api/gemini/quick`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to get quick response');
    }

    const data = await response.json();
    return data.text;
  } catch (error) {
    console.error('Error in getLowLatencyResponse:', error);
    return handleApiError(error, 'Failed to get a low-latency response.');
  }
};

/**
 * Get deep analysis response (with extended thinking)
 */
export const getDeepAnalysisResponse = async (prompt: string): Promise<string> => {
  try {
    const response = await fetch(`${API_URL}/api/gemini/deep`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to get deep analysis');
    }

    const data = await response.json();
    return data.text;
  } catch (error) {
    console.error('Error in getDeepAnalysisResponse:', error);
    return handleApiError(error, 'Failed to get a deep analysis response.');
  }
};

/**
 * Get predictive analysis response (AQI forecasting)
 */
export const getPredictiveAnalysisResponse = async (
  locationName: string,
  historicalAqi: { month: string; avgAqi: number; avgPm25: number }[],
  historicalWeather: { month: string; avgTemp: number; precipitation: number }[],
  customFactors: string,
  startDate: string,
  endDate: string
): Promise<string> => {
  try {
    const response = await fetch(`${API_URL}/api/gemini/predictive`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        location: locationName,
        aqiData: historicalAqi,
        weatherData: historicalWeather,
        customFactors,
        startDate,
        endDate
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to get predictive analysis');
    }

    const data = await response.json();
    return data.text;
  } catch (error) {
    console.error('Error in getPredictiveAnalysisResponse:', error);
    return handleApiError(error, 'Failed to get a predictive analysis response.');
  }
};

/**
 * Get weather forecast response
 */
export const getWeatherForecastResponse = async (
  locationName: string,
  historicalWeather: { month: string; avgTemp: number; precipitation: number }[],
  customFactors: string,
  startDate: string,
  endDate: string
): Promise<string> => {
  try {
    const response = await fetch(`${API_URL}/api/gemini/weather`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        location: locationName,
        weatherData: historicalWeather,
        customFactors,
        startDate,
        endDate
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to get weather forecast');
    }

    const data = await response.json();
    return data.text;
  } catch (error) {
    console.error('Error in getWeatherForecastResponse:', error);
    return handleApiError(error, 'Failed to get a weather forecast response.');
  }
};

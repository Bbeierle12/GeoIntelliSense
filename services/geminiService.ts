

import { GoogleGenAI, Chat, GenerateContentResponse, GroundingChunk } from "@google/genai";

let ai: GoogleGenAI;
let chat: Chat;

function getAi() {
    if (!ai) {
        const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
        if (!apiKey) {
            throw new Error('Gemini API key not found. Please add GEMINI_API_KEY to your .env.local file.');
        }
        ai = new GoogleGenAI({ apiKey });
    }
    return ai;
}

function initializeChat() {
    const aiInstance = getAi();
    chat = aiInstance.chats.create({
        model: 'gemini-2.5-flash',
        config: {
            systemInstruction: 'You are an expert geospatial and environmental analyst specializing in the San Joaquin Valley. Provide clear, data-driven answers.',
        },
    });
}

export const getChatResponse = async (message: string): Promise<string> => {
    if (!chat) {
        initializeChat();
    }
    try {
        const response: GenerateContentResponse = await chat.sendMessage({ message });
        return response.text;
    } catch (error) {
        console.error("Error in getChatResponse:", error);
        return "Sorry, I encountered an error. Please try again.";
    }
};

export const getGroundedSearchResponse = async (prompt: string): Promise<{ text: string, groundingChunks: GroundingChunk[] }> => {
    const aiInstance = getAi();
    try {
        const response = await aiInstance.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
            config: {
                tools: [{ googleSearch: {} }],
            },
        });
        const text = response.text;
        const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
        return { text, groundingChunks };
    } catch (error) {
        console.error("Error in getGroundedSearchResponse:", error);
        return { text: "Failed to get a grounded response.", groundingChunks: [] };
    }
};

export const getGroundedMapsResponse = async (prompt: string, location: { latitude: number; longitude: number }): Promise<{ text: string, groundingChunks: GroundingChunk[] }> => {
    const aiInstance = getAi();
    try {
        const response = await aiInstance.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
            config: {
                tools: [{ googleMaps: {} }],
                toolConfig: {
                    retrievalConfig: {
                        latLng: location,
                    }
                }
            },
        });
        const text = response.text;
        const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
        return { text, groundingChunks };
    } catch (error) {
        console.error("Error in getGroundedMapsResponse:", error);
        return { text: "Failed to get a map-grounded response. Please ensure location permissions are enabled.", groundingChunks: [] };
    }
};

export const getLowLatencyResponse = async (prompt: string): Promise<string> => {
    const aiInstance = getAi();
    try {
        const response = await aiInstance.models.generateContent({
            // FIX: Use the correct model name for gemini flash lite.
            model: "gemini-flash-lite-latest",
            contents: prompt,
        });
        return response.text;
    } catch (error) {
        console.error("Error in getLowLatencyResponse:", error);
        return "Failed to get a low-latency response.";
    }
};

export const getDeepAnalysisResponse = async (prompt: string): Promise<string> => {
    const aiInstance = getAi();
    try {
        const response = await aiInstance.models.generateContent({
            model: "gemini-2.5-pro",
            contents: prompt,
            config: {
                thinkingConfig: { thinkingBudget: 32768 }
            },
        });
        return response.text;
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
    const aiInstance = getAi();
    
    const combinedHistoricalData = historicalAqi.map((aqiData, index) => ({
        ...aqiData,
        ...historicalWeather[index],
    }));

    const customFactorsSection = customFactors.trim() 
    ? `
**User-Provided Influencing Factors:**
Please take the following user-provided context into account:
\`\`\`
${customFactors}
\`\`\`
` 
    : '';

    const prompt = `
You are an expert environmental data scientist specializing in California's San Joaquin Valley. Your task is to provide a predictive analysis of air quality and weather trends for the next three months.

**Location:** ${locationName}

**Provided Historical Data:**
**Date Range of Data:** ${startDate} to ${endDate}
\`\`\`json
${JSON.stringify(combinedHistoricalData, null, 2)}
\`\`\`
${customFactorsSection}
**Instructions:**
Based on the provided historical data, general seasonal patterns for the region, and any user-provided factors, generate a detailed forecast for the next 3 months.

Present the forecast in a clear, well-structured Markdown format with distinct sections:

**1. Air Quality Forecast:**
*   **Predicted AQI Trend:** Forecast the likely average AQI for each of the next three months, explaining the reasoning (e.g., heat, agricultural activity, stagnation, lack of rain).
*   **Predicted PM2.5 Trend:** Forecast the likely average PM2.5 levels for the same period.

**2. Weather Forecast:**
*   **Predicted Temperature Trend:** Forecast the expected average temperature (°F) for each of the next three months.
*   **Predicted Precipitation Trend:** Forecast the expected total precipitation (in inches) for each month.

**3. Overall Analysis:**
*   **Impact of Custom Factors:** If custom factors were provided, explicitly state how they influenced your prediction. If not, omit this section.
*   **Confidence Level:** State your confidence in this prediction (e.g., High, Medium, Low) and mention potential variables that could alter the outcome.
`;

    try {
        const response = await aiInstance.models.generateContent({
            model: "gemini-2.5-pro",
            contents: prompt,
            config: {
                thinkingConfig: { thinkingBudget: 32768 }
            },
        });
        return response.text;
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
    const aiInstance = getAi();

    const customFactorsSection = customFactors.trim()
    ? `
**User-Provided Influencing Factors:**
Please take the following user-provided context into account:
\`\`\`
${customFactors}
\`\`\`
`
    : '';

    const prompt = `
You are an expert meteorologist specializing in California's San Joaquin Valley. Your task is to provide a predictive analysis of weather trends for the next three months.

**Location:** ${locationName}

**Provided Historical Data:**
**Date Range of Data:** ${startDate} to ${endDate}
\`\`\`json
${JSON.stringify(historicalWeather, null, 2)}
\`\`\`
${customFactorsSection}
**Instructions:**
Based on the provided historical data, general seasonal patterns for the region, and any user-provided factors, generate a detailed weather forecast for the next 3 months.

Present the forecast in a clear, well-structured Markdown format:

**1. Weather Forecast:**
*   **Predicted Temperature Trend:** Forecast the expected average temperature (°F) for each of the next three months, explaining your reasoning (e.g., seasonal shifts, heat dome potential, ocean temperature influences).
*   **Predicted Precipitation Trend:** Forecast the expected total precipitation (in inches) for each month, explaining your reasoning (e.g., storm track possibilities, atmospheric river potential).

**2. Overall Analysis:**
*   **Impact of Custom Factors:** If custom factors were provided, explicitly state how they influenced your prediction. If not, omit this section.
*   **Confidence Level:** State your confidence in this prediction (e.g., High, Medium, Low) and mention potential variables that could alter the outcome (e.g., unexpected shifts in jet stream, El Niño/La Niña status).

**IMPORTANT:** Do NOT include any analysis or forecast related to air quality (AQI, PM2.5). Focus exclusively on meteorological conditions.
`;

    try {
        const response = await aiInstance.models.generateContent({
            model: "gemini-2.5-pro",
            contents: prompt,
            config: {
                thinkingConfig: { thinkingBudget: 32768 }
            },
        });
        return response.text;
    } catch (error) {
        console.error("Error in getWeatherForecastResponse:", error);
        return "Failed to get a weather forecast response.";
    }
};
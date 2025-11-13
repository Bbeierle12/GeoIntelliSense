import { GoogleGenAI, Chat, GenerateContentResponse, GroundingChunk } from "@google/genai";

let ai: GoogleGenAI;
let chat: Chat;

function getAi() {
    if (!ai) {
        ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
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
            model: "gemini-2.5-flash-lite",
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
    historicalWeather: { month: string; avgTemp: number; precipitation: number }[]
): Promise<string> => {
    const aiInstance = getAi();
    
    const combinedHistoricalData = historicalAqi.map((aqiData, index) => ({
        ...aqiData,
        ...historicalWeather[index],
    }));

    const prompt = `
You are an expert environmental data scientist specializing in California's San Joaquin Valley. Your task is to provide a predictive analysis of air quality and weather trends for the next three months.

**Location:** ${locationName}

**Provided Historical Data (Past 12 Months):**
\`\`\`json
${JSON.stringify(combinedHistoricalData, null, 2)}
\`\`\`

**Instructions:**
Based *only* on the historical data provided and general seasonal patterns for this region, please generate a forecast for the next 3 months. Your analysis should cover:
1.  **Predicted AQI Trend:** Forecast the likely average AQI, explaining the reasoning (e.g., heat, agricultural activity, lack of rain).
2.  **Predicted PM2.5 Trend:** Forecast the likely average PM2.5 levels.
3.  **Predicted Weather:** Briefly describe expected temperature and precipitation patterns.
4.  **Confidence Level:** State your confidence in this prediction (e.g., High, Medium, Low) and mention any potential variables that could alter the outcome.

Present the forecast in a clear, well-structured Markdown format.
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

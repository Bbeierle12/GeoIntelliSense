import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

dotenv.config({ path: '.env.local' });

const app = express();
const PORT = process.env.PORT || 3001;

// Request timeout middleware
const REQUEST_TIMEOUT = 30000; // 30 seconds

app.use((req, res, next) => {
    req.setTimeout(REQUEST_TIMEOUT, () => {
        res.status(408).json({
            error: true,
            code: 'TIMEOUT',
            message: 'Request timeout',
            retryable: true
        });
    });
    next();
});

app.use(cors());
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${req.method} ${req.path}`);
    next();
});

let ai;

function getAi() {
    if (!ai) {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            throw new Error('GEMINI_API_KEY not found in environment variables');
        }
        ai = new GoogleGenAI({ apiKey });
    }
    return ai;
}

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Chat endpoint
let chat;
app.post('/api/chat', async (req, res) => {
    try {
        const { message } = req.body;

        if (!chat) {
            const aiInstance = getAi();
            chat = aiInstance.chats.create({
                model: 'gemini-2.5-flash',
                config: {
                    systemInstruction: 'You are an expert geospatial and environmental analyst specializing in the San Joaquin Valley. Provide clear, data-driven answers.',
                },
            });
        }

        const response = await chat.sendMessage({ message });
        res.json({ text: response.text });
    } catch (error) {
        console.error('Error in /api/chat:', error);
        res.status(500).json({ error: 'Failed to get chat response', details: error.message });
    }
});

// Grounded search endpoint
app.post('/api/grounded-search', async (req, res) => {
    try {
        const { prompt } = req.body;
        const aiInstance = getAi();

        const response = await aiInstance.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
            config: {
                tools: [{ googleSearch: {} }],
            },
        });

        const text = response.text;
        const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];

        res.json({ text, groundingChunks });
    } catch (error) {
        console.error('Error in /api/grounded-search:', error);
        res.status(500).json({ error: 'Failed to get grounded search response', details: error.message });
    }
});

// Grounded maps endpoint
app.post('/api/grounded-maps', async (req, res) => {
    try {
        const { prompt, location } = req.body;
        const aiInstance = getAi();

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

        res.json({ text, groundingChunks });
    } catch (error) {
        console.error('Error in /api/grounded-maps:', error);
        res.status(500).json({ error: 'Failed to get map-grounded response', details: error.message });
    }
});

// Low latency response endpoint
app.post('/api/low-latency', async (req, res) => {
    try {
        const { prompt } = req.body;
        const aiInstance = getAi();

        const response = await aiInstance.models.generateContent({
            model: "gemini-flash-lite-latest",
            contents: prompt,
        });

        res.json({ text: response.text });
    } catch (error) {
        console.error('Error in /api/low-latency:', error);
        res.status(500).json({ error: 'Failed to get low-latency response', details: error.message });
    }
});

// Deep analysis endpoint
app.post('/api/deep-analysis', async (req, res) => {
    try {
        const { prompt } = req.body;
        const aiInstance = getAi();

        const response = await aiInstance.models.generateContent({
            model: "gemini-2.5-pro",
            contents: prompt,
            config: {
                thinkingConfig: { thinkingBudget: 32768 }
            },
        });

        res.json({ text: response.text });
    } catch (error) {
        console.error('Error in /api/deep-analysis:', error);
        res.status(500).json({ error: 'Failed to get deep analysis response', details: error.message });
    }
});

// Predictive analysis endpoint
app.post('/api/predictive-analysis', async (req, res) => {
    try {
        const { locationName, historicalAqi, historicalWeather, customFactors, startDate, endDate } = req.body;
        const aiInstance = getAi();

        const combinedHistoricalData = historicalAqi.map((aqiData, index) => ({
            ...aqiData,
            ...historicalWeather[index],
        }));

        const customFactorsSection = customFactors?.trim()
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

        const response = await aiInstance.models.generateContent({
            model: "gemini-2.5-pro",
            contents: prompt,
            config: {
                thinkingConfig: { thinkingBudget: 32768 }
            },
        });

        res.json({ text: response.text });
    } catch (error) {
        console.error('Error in /api/predictive-analysis:', error);
        res.status(500).json({ error: 'Failed to get predictive analysis response', details: error.message });
    }
});

// Weather forecast endpoint
app.post('/api/weather-forecast', async (req, res) => {
    try {
        const { locationName, historicalWeather, customFactors, startDate, endDate } = req.body;
        const aiInstance = getAi();

        const customFactorsSection = customFactors?.trim()
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

        const response = await aiInstance.models.generateContent({
            model: "gemini-2.5-pro",
            contents: prompt,
            config: {
                thinkingConfig: { thinkingBudget: 32768 }
            },
        });

        res.json({ text: response.text });
    } catch (error) {
        console.error('Error in /api/weather-forecast:', error);
        res.status(500).json({ error: 'Failed to get weather forecast response', details: error.message });
    }
});

// Google Maps API key endpoint (proxies the key for frontend use)
app.get('/api/maps-config', (req, res) => {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: 'GOOGLE_MAPS_API_KEY not configured' });
    }
    res.json({ apiKey });
});

// 404 handler for unknown API routes
app.use('/api/*', (req, res) => {
    res.status(404).json({
        error: true,
        code: 'NOT_FOUND',
        message: `API endpoint not found: ${req.path}`,
        retryable: false
    });
});

// Global error handling middleware
app.use((err, req, res, next) => {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] Server error:`, err);

    // Determine status code
    const status = err.status || err.statusCode || 500;
    
    // Check if error is retryable
    const retryable = status >= 500 || status === 408 || status === 429;
    
    // Determine error code
    let code = 'SERVER_ERROR';
    if (status === 401 || status === 403) {
        code = 'API_KEY_INVALID';
    } else if (status === 404) {
        code = 'DATA_NOT_FOUND';
    } else if (status === 429) {
        code = 'RATE_LIMIT_EXCEEDED';
    } else if (status === 408) {
        code = 'TIMEOUT';
    } else if (status === 400) {
        code = 'INVALID_PARAMETERS';
    }
    
    // Don't expose internal error details to client in production
    const message = status === 500 
        ? 'Internal server error' 
        : err.message || 'An error occurred';

    res.status(status).json({
        error: true,
        code,
        message,
        retryable,
        timestamp
    });
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

app.listen(PORT, () => {
    console.log(`Backend server running on http://localhost:${PORT}`);
    console.log(`API endpoints available at http://localhost:${PORT}/api/*`);
});

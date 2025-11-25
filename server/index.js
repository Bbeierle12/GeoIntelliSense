import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

dotenv.config({ path: '.env.local' });

const app = express();
const PORT = process.env.PORT || 3001;

// =============================================================================
// SSE CLIENT MANAGEMENT FOR REAL-TIME DATA
// =============================================================================

const sseClients = new Set();

// Simulated AQI data for San Joaquin Valley cities
const cityData = {
    'Bakersfield': { lat: 35.3733, lng: -119.0187, baseAqi: 95, basePm25: 28 },
    'Fresno': { lat: 36.7378, lng: -119.7871, baseAqi: 78, basePm25: 22 },
    'Visalia': { lat: 36.3302, lng: -119.2921, baseAqi: 82, basePm25: 24 },
    'Merced': { lat: 37.3022, lng: -120.4830, baseAqi: 65, basePm25: 18 },
    'Modesto': { lat: 37.6391, lng: -120.9969, baseAqi: 58, basePm25: 15 },
    'Stockton': { lat: 37.9577, lng: -121.2908, baseAqi: 52, basePm25: 12 },
};

// Generate realistic AQI variations
function generateAQIData() {
    const timestamp = new Date().toISOString();
    const hour = new Date().getHours();
    
    // AQI tends to be worse in early morning and evening (inversion layers)
    const timeMultiplier = hour < 8 || hour > 18 ? 1.15 : hour < 12 ? 0.95 : 1.05;
    
    const cities = Object.entries(cityData).map(([name, data]) => {
        // Add some random variation
        const variation = (Math.random() - 0.5) * 20;
        const aqi = Math.max(0, Math.min(500, Math.round(data.baseAqi * timeMultiplier + variation)));
        const pm25 = Math.max(0, Math.round(data.basePm25 * timeMultiplier + variation * 0.5));
        
        // Simulate wind data
        const windDirection = (270 + Math.random() * 90) % 360; // Mostly westerly
        const windSpeed = 5 + Math.random() * 15;
        
        // Temperature varies by time of day
        const baseTemp = 72;
        const tempVariation = hour < 8 ? -10 : hour < 12 ? 0 : hour < 18 ? 15 : 5;
        const temperature = Math.round(baseTemp + tempVariation + (Math.random() - 0.5) * 8);
        
        const humidity = Math.round(35 + Math.random() * 30);
        
        return {
            id: name,
            name,
            lat: data.lat,
            lng: data.lng,
            aqi,
            pm25,
            pm10: Math.round(pm25 * 1.4),
            o3: Math.round(20 + Math.random() * 40),
            no2: Math.round(10 + Math.random() * 25),
            windSpeed,
            windDirection,
            temperature,
            humidity,
            timestamp,
        };
    });
    
    // Calculate regional stats
    const aqiValues = cities.map(c => c.aqi);
    const stats = {
        averageAQI: Math.round(aqiValues.reduce((a, b) => a + b, 0) / aqiValues.length),
        maxAQI: Math.max(...aqiValues),
        minAQI: Math.min(...aqiValues),
        timestamp,
    };
    
    return { cities, stats };
}

// Broadcast to all SSE clients
function broadcastAQIData() {
    const data = generateAQIData();
    const message = `data: ${JSON.stringify(data)}\n\n`;
    
    for (const client of sseClients) {
        client.write(message);
    }
}

// Start broadcasting AQI data every 5 seconds
setInterval(broadcastAQIData, 5000);

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

// =============================================================================
// SSE ENDPOINT FOR REAL-TIME AQI DATA
// =============================================================================

app.get('/api/aqi-stream', (req, res) => {
    // Set headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.flushHeaders();
    
    // Send initial data immediately
    const initialData = generateAQIData();
    res.write(`data: ${JSON.stringify(initialData)}\n\n`);
    
    // Add client to set
    sseClients.add(res);
    console.log(`SSE client connected. Total clients: ${sseClients.size}`);
    
    // Send heartbeat every 30 seconds to keep connection alive
    const heartbeat = setInterval(() => {
        res.write(': heartbeat\n\n');
    }, 30000);
    
    // Remove client when connection closes
    req.on('close', () => {
        clearInterval(heartbeat);
        sseClients.delete(res);
        console.log(`SSE client disconnected. Total clients: ${sseClients.size}`);
    });
});

// Get current AQI snapshot (for initial load)
app.get('/api/aqi-snapshot', (req, res) => {
    const data = generateAQIData();
    res.json(data);
});

// Get historical AQI data (simulated)
app.get('/api/aqi-history', (req, res) => {
    const { city, hours = 24 } = req.query;
    const now = Date.now();
    const history = [];
    
    for (let i = 0; i < hours; i++) {
        const timestamp = new Date(now - i * 3600000).toISOString();
        const hour = new Date(timestamp).getHours();
        const timeMultiplier = hour < 8 || hour > 18 ? 1.15 : hour < 12 ? 0.95 : 1.05;
        
        if (city && cityData[city]) {
            const data = cityData[city];
            const variation = (Math.random() - 0.5) * 15;
            history.push({
                timestamp,
                aqi: Math.max(0, Math.round(data.baseAqi * timeMultiplier + variation)),
                pm25: Math.max(0, Math.round(data.basePm25 * timeMultiplier + variation * 0.5)),
            });
        } else {
            // Return all cities
            const allCities = {};
            for (const [name, data] of Object.entries(cityData)) {
                const variation = (Math.random() - 0.5) * 15;
                allCities[name] = {
                    aqi: Math.max(0, Math.round(data.baseAqi * timeMultiplier + variation)),
                    pm25: Math.max(0, Math.round(data.basePm25 * timeMultiplier + variation * 0.5)),
                };
            }
            history.push({ timestamp, cities: allCities });
        }
    }
    
    res.json({ history: history.reverse() });
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

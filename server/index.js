import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/genai';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Validate API key on startup
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error('ERROR: GEMINI_API_KEY environment variable is required');
  process.exit(1);
}

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// Rate limiting helper (simple in-memory implementation)
const requestCounts = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 50;

function checkRateLimit(ip) {
  const now = Date.now();
  const userRequests = requestCounts.get(ip) || [];

  // Filter out old requests
  const recentRequests = userRequests.filter(time => now - time < RATE_LIMIT_WINDOW);

  if (recentRequests.length >= MAX_REQUESTS_PER_WINDOW) {
    return false;
  }

  recentRequests.push(now);
  requestCounts.set(ip, recentRequests);
  return true;
}

// Input validation helper
function validateInput(input, maxLength = 5000) {
  if (!input || typeof input !== 'string') {
    return { valid: false, error: 'Input must be a non-empty string' };
  }
  if (input.length > maxLength) {
    return { valid: false, error: `Input exceeds maximum length of ${maxLength} characters` };
  }
  return { valid: true };
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Chat endpoint (for ChatView)
app.post('/api/gemini/chat', async (req, res) => {
  try {
    // Rate limiting
    const clientIp = req.ip || req.connection.remoteAddress;
    if (!checkRateLimit(clientIp)) {
      return res.status(429).json({ error: 'Rate limit exceeded. Please try again later.' });
    }

    const { message, history } = req.body;

    // Validate input
    const validation = validateInput(message);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    // Use Gemini Flash for chat
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    // Build chat history
    const chat = model.startChat({
      history: history || [],
    });

    const result = await chat.sendMessage(message);
    const response = await result.response;

    res.json({
      text: response.text(),
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error in chat endpoint:', error);
    res.status(500).json({
      error: 'Failed to process chat request',
      message: error.message
    });
  }
});

// Low latency response endpoint (Quick Insight)
app.post('/api/gemini/quick', async (req, res) => {
  try {
    const clientIp = req.ip || req.connection.remoteAddress;
    if (!checkRateLimit(clientIp)) {
      return res.status(429).json({ error: 'Rate limit exceeded. Please try again later.' });
    }

    const { prompt } = req.body;
    const validation = validateInput(prompt);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash-8b' });
    const result = await model.generateContent(prompt);
    const response = await result.response;

    res.json({ text: response.text() });

  } catch (error) {
    console.error('Error in quick endpoint:', error);
    res.status(500).json({
      error: 'Failed to process request',
      message: error.message
    });
  }
});

// Grounded search endpoint
app.post('/api/gemini/search', async (req, res) => {
  try {
    const clientIp = req.ip || req.connection.remoteAddress;
    if (!checkRateLimit(clientIp)) {
      return res.status(429).json({ error: 'Rate limit exceeded. Please try again later.' });
    }

    const { prompt } = req.body;
    const validation = validateInput(prompt);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      tools: [{ googleSearch: {} }]
    });

    const result = await model.generateContent(prompt);
    const response = await result.response;

    res.json({
      text: response.text(),
      groundingChunks: response.candidates?.[0]?.groundingMetadata?.groundingChunks || []
    });

  } catch (error) {
    console.error('Error in search endpoint:', error);
    res.status(500).json({
      error: 'Failed to process search request',
      message: error.message
    });
  }
});

// Grounded maps endpoint
app.post('/api/gemini/maps', async (req, res) => {
  try {
    const clientIp = req.ip || req.connection.remoteAddress;
    if (!checkRateLimit(clientIp)) {
      return res.status(429).json({ error: 'Rate limit exceeded. Please try again later.' });
    }

    const { prompt, location } = req.body;
    const validation = validateInput(prompt);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    if (!location || typeof location.latitude !== 'number' || typeof location.longitude !== 'number') {
      return res.status(400).json({ error: 'Valid location coordinates required' });
    }

    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      tools: [{ googleMaps: {} }]
    });

    const enhancedPrompt = `${prompt}\n\nUser location: ${location.latitude}, ${location.longitude}`;
    const result = await model.generateContent(enhancedPrompt);
    const response = await result.response;

    res.json({
      text: response.text(),
      groundingChunks: response.candidates?.[0]?.groundingMetadata?.groundingChunks || []
    });

  } catch (error) {
    console.error('Error in maps endpoint:', error);
    res.status(500).json({
      error: 'Failed to process maps request',
      message: error.message
    });
  }
});

// Deep analysis endpoint (with thinking mode)
app.post('/api/gemini/deep', async (req, res) => {
  try {
    const clientIp = req.ip || req.connection.remoteAddress;
    if (!checkRateLimit(clientIp)) {
      return res.status(429).json({ error: 'Rate limit exceeded. Please try again later.' });
    }

    const { prompt } = req.body;
    const validation = validateInput(prompt);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash-thinking-exp-1219'
    });

    const result = await model.generateContent(prompt);
    const response = await result.response;

    res.json({ text: response.text() });

  } catch (error) {
    console.error('Error in deep analysis endpoint:', error);
    res.status(500).json({
      error: 'Failed to process deep analysis request',
      message: error.message
    });
  }
});

// Predictive analysis endpoint
app.post('/api/gemini/predictive', async (req, res) => {
  try {
    const clientIp = req.ip || req.connection.remoteAddress;
    if (!checkRateLimit(clientIp)) {
      return res.status(429).json({ error: 'Rate limit exceeded. Please try again later.' });
    }

    const { location, aqiData, weatherData, customFactors, startDate, endDate } = req.body;

    // Validate inputs
    if (!location || !aqiData || !weatherData) {
      return res.status(400).json({ error: 'Missing required data' });
    }

    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro' });

    const prompt = `You are an air quality forecasting expert. Based on the historical data provided, predict future AQI trends for ${location}.

Historical AQI Data (${startDate} to ${endDate}):
${JSON.stringify(aqiData, null, 2)}

Historical Weather Data:
${JSON.stringify(weatherData, null, 2)}

${customFactors ? `Additional Factors to Consider:\n${customFactors}\n` : ''}

Please provide:
1. A 7-day AQI forecast
2. Key factors influencing the forecast
3. Recommendations for residents
4. Confidence level in predictions

Format your response clearly with sections.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;

    res.json({ text: response.text() });

  } catch (error) {
    console.error('Error in predictive endpoint:', error);
    res.status(500).json({
      error: 'Failed to process predictive analysis',
      message: error.message
    });
  }
});

// Weather forecast endpoint
app.post('/api/gemini/weather', async (req, res) => {
  try {
    const clientIp = req.ip || req.connection.remoteAddress;
    if (!checkRateLimit(clientIp)) {
      return res.status(429).json({ error: 'Rate limit exceeded. Please try again later.' });
    }

    const { location, weatherData, customFactors, startDate, endDate } = req.body;

    if (!location || !weatherData) {
      return res.status(400).json({ error: 'Missing required data' });
    }

    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro' });

    const prompt = `You are a meteorology expert. Based on the historical weather data provided, forecast future weather conditions for ${location}.

Historical Weather Data (${startDate} to ${endDate}):
${JSON.stringify(weatherData, null, 2)}

${customFactors ? `Additional Factors to Consider:\n${customFactors}\n` : ''}

Please provide:
1. A 7-day weather forecast (temperature and precipitation)
2. Notable weather patterns or trends
3. Confidence level in predictions

Format your response clearly with sections.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;

    res.json({ text: response.text() });

  } catch (error) {
    console.error('Error in weather forecast endpoint:', error);
    res.status(500).json({
      error: 'Failed to process weather forecast',
      message: error.message
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'An unexpected error occurred'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Backend server running on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/api/health`);
  console.log(`🔐 API key loaded: ${GEMINI_API_KEY.substring(0, 10)}...`);
});

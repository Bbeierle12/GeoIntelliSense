<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# GeoIntelliSense

An AI-powered geospatial intelligence application for analyzing air quality and weather patterns in California's San Joaquin Valley.

View your app in AI Studio: https://ai.studio/apps/drive/1TSTROmMZDi_NK0VF4oiiW_i2TPkn1j5C

## Features

- **Interactive Map**: Real-time AQI visualization with marker clustering and search functionality
- **AI Chat**: Ask questions about air quality and weather using Gemini AI
- **Advanced Analysis Tools**: Multiple analysis modes including web search, maps, deep analysis, and predictive forecasting
- **Historical Trends**: View 12-month historical data for air quality and weather
- **Weather Forecasts**: 7-day forecasts and predictive analysis with custom influencing factors

## Tech Stack

- **Frontend**: React 19 + TypeScript + Vite
- **Backend**: Express.js + Node.js
- **Styling**: Tailwind CSS
- **Charts**: Recharts
- **Maps**: Google Maps API with marker clustering
- **AI**: Google Gemini API (Flash, Flash-Lite, Pro models)

## Run Locally

**Prerequisites:**  Node.js 18+

### Quick Start (Development)

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set up environment variables:**

   Create a `.env` file in the root directory:
   ```bash
   # Backend Configuration
   GEMINI_API_KEY=your_api_key_here
   PORT=3001
   NODE_ENV=development
   ```

   Create a `.env.local` file (optional, for custom backend URL):
   ```bash
   VITE_API_URL=http://localhost:3001
   ```

3. **Run both frontend and backend:**
   ```bash
   npm run dev:all
   ```

   Or run them separately in different terminals:
   ```bash
   # Terminal 1 - Backend server
   npm run dev:server

   # Terminal 2 - Frontend dev server
   npm run dev
   ```

4. **Open the app:**
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:3001

### Production Deployment

1. **Build the frontend:**
   ```bash
   npm run build
   ```

2. **Start the backend server:**
   ```bash
   npm start
   ```

3. **Serve the frontend** using a static file server (nginx, Vercel, Netlify, etc.)

## ✅ Security Features

**SECURE**: This application now uses a backend proxy server to keep the API key secure!

✅ API keys stored server-side only
✅ Client-side code has NO access to sensitive credentials
✅ Rate limiting implemented (50 requests/minute per IP)
✅ Input validation on all endpoints
✅ CORS protection enabled

## Recent Improvements

### Week 3: Backend Security Implementation ✅
- Implemented Express backend proxy server
- Removed API key from client-side code
- Added rate limiting and input validation
- Secured all Gemini API endpoints

### Week 2-3: Code Quality & Accessibility ✅
- Created shared constants for AQI, locations, and validation
- Improved TypeScript type safety (reduced `any` types)
- Added comprehensive ARIA labels for accessibility
- Pinned all dependency versions

### Week 1: Critical Security Fixes ✅
- Fixed XSS vulnerability in analysis results
- Added comprehensive input validation
- Implemented React Error Boundary
- Created detailed security documentation

## Project Structure

```
GeoIntelliSense/
├── components/          # React components
│   ├── Dashboard.tsx    # Main dashboard with charts
│   ├── ChatView.tsx     # AI chat interface
│   ├── AnalysisView.tsx # Advanced analysis tools
│   ├── MapView.tsx      # Interactive map view
│   ├── ErrorBoundary.tsx # Error handling component
│   └── icons/           # Icon components
├── server/              # Backend Express server
│   ├── index.js         # Main server file with API endpoints
│   └── .env.example     # Backend environment template
├── services/            # Frontend API services
│   └── geminiService.ts # Backend proxy client
├── constants/           # Shared constants
│   ├── aqi.ts           # AQI thresholds and helpers
│   ├── locations.ts     # Geographic constants
│   └── validation.ts    # Input validation rules
├── data/                # Mock data
│   └── dashboardData.ts # Historical AQI and weather data
├── types.ts             # TypeScript type definitions
├── .env.example         # Frontend environment template
└── SECURITY.md          # Security documentation
```

## Known Limitations

- Uses mock data for historical AQI and weather information
- Limited to San Joaquin Valley region
- Google Maps API key still required for map functionality (separate from Gemini)

## Future Enhancements

- [ ] Add user authentication and authorization
- [ ] Connect to real-time AQI data sources (e.g., PurpleAir, AirNow API)
- [ ] Expand to other geographic regions
- [ ] Add export functionality for reports (PDF, CSV)
- [ ] Implement comprehensive test suite (Vitest + Testing Library)
- [ ] Add error logging/monitoring (Sentry/LogRocket)
- [ ] Implement caching layer (Redis) for API responses
- [ ] Add WebSocket support for real-time updates

## Contributing

Contributions are welcome! Please read [SECURITY.md](SECURITY.md) before submitting pull requests.

## License

[Add your license here]

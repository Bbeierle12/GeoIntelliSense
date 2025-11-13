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
- **Styling**: Tailwind CSS
- **Charts**: Recharts
- **Maps**: Google Maps API with marker clustering
- **AI**: Google Gemini API (Flash, Flash-Lite, Pro models)

## Run Locally

**Prerequisites:**  Node.js 18+

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key:
   ```bash
   GEMINI_API_KEY=your_api_key_here
   ```

3. Run the app:
   ```bash
   npm run dev
   ```

4. Open http://localhost:5173 in your browser

## ⚠️ Security Notice

**IMPORTANT**: This application currently has the API key embedded in the client-side code, which is **not secure for production use**.

Please read [SECURITY.md](SECURITY.md) for:
- Detailed security issues and their severity
- Step-by-step guide to implement a backend proxy
- Best practices for securing API keys
- Additional security recommendations

**For production deployment, you MUST implement a backend proxy server to keep API keys secure.**

## Recent Improvements (Week 1 Security Fixes)

✅ Fixed XSS vulnerability in analysis results
✅ Added comprehensive input validation
✅ Implemented React Error Boundary for better error handling
✅ Documented security issues and remediation steps

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
├── services/            # API services
│   └── geminiService.ts # Gemini API integration
├── data/                # Mock data
│   └── dashboardData.ts # Historical AQI and weather data
└── types.ts             # TypeScript type definitions
```

## Known Limitations

- Uses mock data for historical AQI and weather information
- API key currently client-side (see Security Notice above)
- No backend server (planned for future releases)
- Limited to San Joaquin Valley region

## Future Enhancements

- [ ] Implement backend API proxy for security
- [ ] Add user authentication
- [ ] Connect to real-time AQI data sources
- [ ] Expand to other regions
- [ ] Add export functionality for reports
- [ ] Implement comprehensive test suite
- [ ] Add error logging/monitoring (Sentry)

## Contributing

Contributions are welcome! Please read [SECURITY.md](SECURITY.md) before submitting pull requests.

## License

[Add your license here]

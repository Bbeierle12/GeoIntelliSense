// Reference/fallback data for the dashboard — Kern County only.
//
// IMPORTANT: the AQI and weather numbers below are placeholders, not
// measurements. Live values come from /api/aqi/headline (EPA AirNow, corrected
// PurpleAir) and the weather endpoints. Anything rendered from this file should
// be labelled as sample data; it exists so the UI has shape before the API
// responds and so the location list has one definition.
//
// Scope note: this previously held six San Joaquin Valley cities spanning
// 300 km. The project is Kern-only, so the entries are Kern communities.

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

const MONTHS = [
  "Jul '23", "Aug '23", "Sep '23", "Oct '23", "Nov '23", "Dec '23",
  "Jan '24", "Feb '24", "Mar '24", "Apr '24", "May '24", "Jun '24",
] as const;

// Seasonal shape applied to each community's baseline, so the sample series
// varies month to month the way valley air actually does (worst in summer and
// midwinter, cleanest in spring) without pretending to be a measurement.
const AQI_SEASON = [1.10, 1.20, 1.00, 0.78, 0.97, 1.12, 1.04, 0.74, 0.62, 0.58, 0.70, 0.92];
const TEMP_SEASON = [2, 1, -7, -20, -33, -42, -41, -36, -28, -20, -10, -3];
const PRECIP = [0.05, 0.1, 0.3, 1.2, 2.5, 4.1, 3.9, 3.2, 1.9, 0.8, 0.3, 0.05];

const round = (v: number) => Math.round(v);

/** Build one community's placeholder block from a small set of baselines. */
function sampleCommunity(
  name: string,
  lat: number,
  lng: number,
  aqi: number,
  pm25: number,
  temp: number,
  humidity: number,
) {
  return {
    coords: { lat, lng },
    currentAqi: { aqi, pm25 },
    currentWeather: { temp, humidity },
    weatherForecast: DAYS.map((day, i) => ({
      day,
      temp: temp + [1, 4, 7, 6, 3, 0, 1][i],
      humidity: Math.max(5, humidity - [1, 3, 5, 4, 2, 2, -1][i]),
    })),
    dailyForecast: generateDailyForecast(name, 365),
    historicalAqi: MONTHS.map((month, i) => ({
      month,
      avgAqi: round(aqi * AQI_SEASON[i]),
      avgPm25: round(pm25 * AQI_SEASON[i]),
    })),
    historicalWeather: MONTHS.map((month, i) => ({
      month,
      avgTemp: round(temp + TEMP_SEASON[i]),
      precipitation: PRECIP[i],
    })),
  };
}

export const dashboardData = {
  // County-wide roll-up. Has no `coords`/`currentAqi`, which is how the map and
  // analysis views distinguish it from a single community.
  'Kern County': {
    regionalAqi: [
      { name: 'Bakersfield', aqi: 77, pm25: 18 },
      { name: 'Shafter-Wasco', aqi: 72, pm25: 16 },
      { name: 'Delano', aqi: 70, pm25: 15 },
      { name: 'Taft', aqi: 65, pm25: 14 },
      { name: 'Ridgecrest', aqi: 42, pm25: 8 },
      { name: 'Mojave-Rosamond', aqi: 41, pm25: 8 },
      { name: 'Tehachapi', aqi: 40, pm25: 7 },
      { name: 'California City', aqi: 40, pm25: 7 },
      { name: 'Lake Isabella', aqi: 38, pm25: 7 },
    ],
    currentWeather: { temp: 94, humidity: 25 },
    weatherForecast: DAYS.map((day, i) => ({
      day,
      temp: 94 + [1, 4, 7, 6, 3, 0, 1][i],
      humidity: 25 - [1, 3, 5, 4, 2, 2, -1][i],
    })),
    dailyForecast: generateDailyForecast('Kern County', 365),
    historicalAqi: MONTHS.map((month, i) => ({
      month,
      avgAqi: round(58 * AQI_SEASON[i]),
      avgPm25: round(12 * AQI_SEASON[i]),
    })),
    historicalWeather: MONTHS.map((month, i) => ({
      month,
      avgTemp: round(94 + TEMP_SEASON[i]),
      precipitation: PRECIP[i],
    })),
  },
  'Bakersfield': sampleCommunity('Bakersfield', 35.3733, -119.0187, 77, 18, 98, 23),
  'Shafter-Wasco': sampleCommunity('Shafter-Wasco', 35.5300, -119.3000, 72, 16, 97, 24),
  'Delano': sampleCommunity('Delano', 35.7688, -119.2471, 70, 15, 96, 25),
  'Taft': sampleCommunity('Taft', 35.1425, -119.4565, 65, 14, 95, 22),
  'Tehachapi': sampleCommunity('Tehachapi', 35.1322, -118.4490, 40, 7, 82, 20),
  'Ridgecrest': sampleCommunity('Ridgecrest', 35.6225, -117.6709, 42, 8, 95, 15),
  'Lake Isabella': sampleCommunity('Lake Isabella', 35.6180, -118.4730, 38, 7, 90, 19),
  'California City': sampleCommunity('California City', 35.1258, -117.9859, 40, 7, 92, 17),
  'Mojave-Rosamond': sampleCommunity('Mojave-Rosamond', 34.9500, -118.1700, 41, 8, 91, 18),
};

// Helper functions for meteorological calculations
function calculateFeelsLike(temp: number, humidity: number, windSpeed: number): number {
  if (temp >= 80 && humidity >= 40) {
    // Heat index
    const hi = -42.379 + 2.04901523 * temp + 10.14333127 * humidity 
      - 0.22475541 * temp * humidity - 0.00683783 * temp * temp
      - 0.05481717 * humidity * humidity + 0.00122874 * temp * temp * humidity
      + 0.00085282 * temp * humidity * humidity - 0.00000199 * temp * temp * humidity * humidity;
    return hi;
  } else if (temp <= 50 && windSpeed >= 3) {
    // Wind chill
    const wc = 35.74 + 0.6215 * temp - 35.75 * Math.pow(windSpeed, 0.16) 
      + 0.4275 * temp * Math.pow(windSpeed, 0.16);
    return wc;
  }
  return temp;
}

function calculateET0(temp: number, humidity: number, windSpeed: number, solarRadiation: number): number {
  const tempC = (temp - 32) * 5 / 9;
  const windMs = windSpeed * 0.44704;
  const es = 0.6108 * Math.exp((17.27 * tempC) / (tempC + 237.3));
  const ea = es * (humidity / 100);
  const delta = (4098 * es) / Math.pow(tempC + 237.3, 2);
  const gamma = 0.067;
  
  const radiation = solarRadiation * 0.0864;
  const et0 = (0.408 * delta * radiation + gamma * (900 / (tempC + 273)) * windMs * (es - ea)) 
    / (delta + gamma * (1 + 0.34 * windMs));
  
  return Math.round(Math.max(0, et0) * 100) / 100;
}

function calculateSunTimes(date: Date, latitude: number): { sunrise: string; sunset: string; dayLength: number } {
  const dayOfYear = Math.floor((date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / 86400000);
  const latRad = latitude * Math.PI / 180;
  const declination = 23.45 * Math.sin((360 / 365) * (dayOfYear - 81) * Math.PI / 180);
  const declinationRad = declination * Math.PI / 180;
  const hourAngle = Math.acos(-Math.tan(latRad) * Math.tan(declinationRad));
  const hourAngleDeg = hourAngle * 180 / Math.PI;
  
  const sunriseHour = 12 - hourAngleDeg / 15;
  const sunsetHour = 12 + hourAngleDeg / 15;
  const dayLength = 2 * hourAngleDeg / 15;
  
  const formatTime = (hour: number) => {
    const h = Math.floor(hour);
    const m = Math.round((hour - h) * 60);
    return `${h % 12 || 12}:${m.toString().padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
  };
  
  return {
    sunrise: formatTime(sunriseHour),
    sunset: formatTime(sunsetHour),
    dayLength: Math.round(dayLength * 10) / 10,
  };
}

function determineWeatherCondition(temp: number, precipProb: number, cloudCover: number, windSpeed: number): string {
  if (precipProb > 70) return 'Rainy';
  if (precipProb > 40) return 'Showers';
  if (cloudCover > 80) return 'Overcast';
  if (cloudCover > 50) return 'Cloudy';
  if (cloudCover > 25) return 'Partly Cloudy';
  if (windSpeed > 20) return 'Windy';
  if (temp > 100) return 'Very Hot';
  if (temp > 90) return 'Hot';
  if (temp < 40) return 'Cold';
  return 'Clear';
}

// Helper function to generate comprehensive daily forecast data with advanced meteorological metrics
function generateDailyForecast(location: string, days: number) {
  const forecast = [];
  const baseDate = new Date('2025-11-13');
  
  // Location-specific base values (San Joaquin Valley climate data)
  const locationParams: Record<string, { 
    baseTemp: number; baseAqi: number; basePm25: number; baseHumidity: number;
    elevation: number; latitude: number;
  }> = {
    'Kern County':      { baseTemp: 94, baseAqi: 58, basePm25: 12, baseHumidity: 25, elevation: 400,  latitude: 35.4 },
    'Bakersfield':      { baseTemp: 98, baseAqi: 77, basePm25: 18, baseHumidity: 23, elevation: 404,  latitude: 35.3733 },
    'Shafter-Wasco':    { baseTemp: 97, baseAqi: 72, basePm25: 16, baseHumidity: 24, elevation: 350,  latitude: 35.5300 },
    'Delano':           { baseTemp: 96, baseAqi: 70, basePm25: 15, baseHumidity: 25, elevation: 315,  latitude: 35.7688 },
    'Taft':             { baseTemp: 95, baseAqi: 65, basePm25: 14, baseHumidity: 22, elevation: 950,  latitude: 35.1425 },
    'Tehachapi':        { baseTemp: 82, baseAqi: 40, basePm25: 7,  baseHumidity: 20, elevation: 3970, latitude: 35.1322 },
    'Ridgecrest':       { baseTemp: 95, baseAqi: 42, basePm25: 8,  baseHumidity: 15, elevation: 2290, latitude: 35.6225 },
    'Lake Isabella':    { baseTemp: 90, baseAqi: 38, basePm25: 7,  baseHumidity: 19, elevation: 2605, latitude: 35.6180 },
    'California City':  { baseTemp: 92, baseAqi: 40, basePm25: 7,  baseHumidity: 17, elevation: 2400, latitude: 35.1258 },
    'Mojave-Rosamond':  { baseTemp: 91, baseAqi: 41, basePm25: 8,  baseHumidity: 18, elevation: 2580, latitude: 34.9500 },
  };
  
  const params = locationParams[location] || locationParams['Kern County'];
  
  for (let i = 0; i < days; i++) {
    const date = new Date(baseDate);
    date.setDate(date.getDate() + i);
    
    const dayOfYear = Math.floor((date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / 86400000);
    const seasonalTemp = 25 * Math.sin((dayOfYear - 80) * Math.PI / 182.5);
    const dailyVariation = Math.sin(i * 0.3) * 5;
    const temp = Math.round(params.baseTemp + seasonalTemp + dailyVariation);
    const tempMin = Math.round(temp - 15 - Math.random() * 5);
    const tempMax = Math.round(temp + 8 + Math.random() * 5);
    
    const humidity = Math.max(15, Math.min(90, Math.round(params.baseHumidity - seasonalTemp * 0.3 + (Math.random() - 0.5) * 10)));
    const windSpeed = Math.round(3 + Math.random() * 12);
    const windDirections = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const windDirection = windDirections[Math.floor(Math.random() * windDirections.length)];
    const windGust = Math.round(windSpeed * (1.2 + Math.random() * 0.5));
    
    const feelsLike = Math.round(calculateFeelsLike(temp, humidity, windSpeed));
    const dewPoint = Math.round(temp - ((100 - humidity) / 5));
    
    const basePressure = 29.92 - (params.elevation / 1000);
    const pressureVariation = (Math.random() - 0.5) * 0.6;
    const pressure = Math.round((basePressure + pressureVariation) * 100) / 100;
    
    const uvBase = 5 + 5 * Math.sin((dayOfYear - 80) * Math.PI / 182.5);
    const latitudeModifier = 1 - (Math.abs(params.latitude - 35) * 0.02);
    const uv = Math.max(0, Math.min(11, Math.round(uvBase * latitudeModifier + (Math.random() - 0.5) * 2)));
    
    const precipProb = Math.max(0, Math.min(100, Math.round(30 - 25 * Math.sin((dayOfYear - 80) * Math.PI / 182.5) + (Math.random() - 0.5) * 20)));
    const precipAmount = precipProb > 50 ? Math.round((0.1 + Math.random() * 0.5) * 10) / 10 : 0;
    const precipType = temp < 32 ? 'snow' : precipProb > 70 ? 'rain' : precipProb > 30 ? 'chance' : 'none';
    
    const cloudCover = Math.max(0, Math.min(100, Math.round(precipProb * 0.7 + (Math.random() - 0.5) * 30)));
    const visibility = cloudCover > 70 ? Math.round(5 + Math.random() * 5) : Math.round(8 + Math.random() * 2);
    
    const maxSolarRadiation = 1000;
    const solarRadiation = Math.round(maxSolarRadiation * (1 - cloudCover / 150) * (uv / 11));
    const et0 = calculateET0(temp, humidity, windSpeed, solarRadiation);
    
    const moonPhase = ((dayOfYear % 29.53) / 29.53);
    const { sunrise, sunset, dayLength } = calculateSunTimes(date, params.latitude);
    
    const seasonalAqi = 30 * Math.abs(Math.sin((dayOfYear - 80) * Math.PI / 182.5));
    const aqi = Math.max(20, Math.round(params.baseAqi + seasonalAqi + (Math.random() - 0.5) * 40));
    const pm25 = Math.max(10, Math.round(params.basePm25 + seasonalAqi * 0.4 + (Math.random() - 0.5) * 20));
    
    const condition = determineWeatherCondition(temp, precipProb, cloudCover, windSpeed);
    
    const hourlyData = [];
    for (let hour = 0; hour < 24; hour++) {
      const hourTemp = temp + Math.sin((hour - 14) * Math.PI / 12) * (tempMax - temp) * 0.8;
      const hourHumidity = humidity - Math.sin((hour - 14) * Math.PI / 12) * 15;
      const hourWindSpeed = windSpeed + Math.sin(hour * Math.PI / 8) * 3;
      const hourCloudCover = Math.max(0, Math.min(100, cloudCover + (Math.random() - 0.5) * 20));
      const hourPressure = pressure + (Math.random() - 0.5) * 0.05;
      const hourDewPoint = Math.round(hourTemp - ((100 - hourHumidity) / 5));
      const hourFeelsLike = calculateFeelsLike(hourTemp, hourHumidity, hourWindSpeed);
      
      const hourSolarRad = hour >= 6 && hour <= 18 
        ? Math.round(solarRadiation * Math.sin((hour - 6) * Math.PI / 12))
        : 0;
      
      hourlyData.push({
        hour,
        temp: Math.round(hourTemp),
        feelsLike: Math.round(hourFeelsLike),
        humidity: Math.max(10, Math.min(100, Math.round(hourHumidity))),
        dewPoint: hourDewPoint,
        windSpeed: Math.max(0, Math.round(hourWindSpeed)),
        windGust: Math.max(0, Math.round(hourWindSpeed * 1.3)),
        windDirection,
        pressure: Math.round(hourPressure * 100) / 100,
        cloudCover: Math.round(hourCloudCover),
        visibility,
        precipProb: hour >= 10 && hour <= 16 ? Math.round(precipProb * 1.2) : Math.round(precipProb * 0.8),
        solarRadiation: hourSolarRad,
        uv: hourSolarRad > 0 ? Math.max(0, Math.round(uv * (hourSolarRad / solarRadiation))) : 0,
        aqi: Math.max(0, Math.round(aqi + (Math.random() - 0.5) * 20)),
        pm25: Math.max(0, Math.round(pm25 + (Math.random() - 0.5) * 10)),
      });
    }
    
    forecast.push({
      date: date.toISOString().split('T')[0],
      dayOfWeek: date.toLocaleDateString('en-US', { weekday: 'short' }),
      temp: {
        current: temp,
        min: tempMin,
        max: tempMax,
        feelsLike,
      },
      humidity,
      dewPoint,
      pressure,
      wind: {
        speed: windSpeed,
        gust: windGust,
        direction: windDirection,
      },
      uv,
      precipitation: {
        probability: precipProb,
        amount: precipAmount,
        type: precipType,
      },
      cloudCover,
      visibility,
      solarRadiation,
      evapotranspiration: et0,
      moonPhase,
      sunrise,
      sunset,
      dayLength,
      condition,
      aqi,
      pm25,
      hourlyData,
    });
  }
  
  return forecast;
}

export type LocationKey = keyof typeof dashboardData;
export const locations = Object.keys(dashboardData) as LocationKey[];
export const cityLocations = locations.filter(l => l !== 'Kern County') as Exclude<LocationKey, 'Kern County'>[];

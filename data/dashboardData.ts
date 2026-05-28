// This file centralizes the mock data for the dashboard to be used across components.

export const dashboardData = {
  'Valley Average': {
    regionalAqi: [
      { name: 'Bakersfield', aqi: 155, pm25: 65 },
      { name: 'Fresno', aqi: 140, pm25: 55 },
      { name: 'Visalia', aqi: 148, pm25: 60 },
      { name: 'Merced', aqi: 110, pm25: 40 },
      { name: 'Modesto', aqi: 125, pm25: 45 },
      { name: 'Stockton', aqi: 98, pm25: 35 },
    ],
    currentWeather: { temp: 94, humidity: 28 },
    weatherForecast: [
      { day: 'Mon', temp: 95, humidity: 25 },
      { day: 'Tue', temp: 98, humidity: 22 },
      { day: 'Wed', temp: 102, humidity: 20 },
      { day: 'Thu', temp: 101, humidity: 21 },
      { day: 'Fri', temp: 99, humidity: 24 },
      { day: 'Sat', temp: 96, humidity: 28 },
      { day: 'Sun', temp: 97, humidity: 26 },
    ],
    dailyForecast: generateDailyForecast('Valley Average', 365),
    historicalAqi: [
        { month: 'Jul \'23', avgAqi: 130, avgPm25: 52 }, { month: 'Aug \'23', avgAqi: 145, avgPm25: 58 }, { month: 'Sep \'23', avgAqi: 120, avgPm25: 48 }, { month: 'Oct \'23', avgAqi: 90, avgPm25: 36 }, { month: 'Nov \'23', avgAqi: 115, avgPm25: 46 }, { month: 'Dec \'23', avgAqi: 135, avgPm25: 54 }, { month: 'Jan \'24', avgAqi: 125, avgPm25: 50 }, { month: 'Feb \'24', avgAqi: 85, avgPm25: 34 }, { month: 'Mar \'24', avgAqi: 70, avgPm25: 28 }, { month: 'Apr \'24', avgAqi: 65, avgPm25: 26 }, { month: 'May \'24', avgAqi: 80, avgPm25: 32 }, { month: 'Jun \'24', avgAqi: 110, avgPm25: 44 },
    ],
    historicalWeather: [
        { month: 'Jul \'23', avgTemp: 98, precipitation: 0.1 }, { month: 'Aug \'23', avgTemp: 96, precipitation: 0.2 }, { month: 'Sep \'23', avgTemp: 88, precipitation: 0.5 }, { month: 'Oct \'23', avgTemp: 75, precipitation: 1.5 }, { month: 'Nov \'23', avgTemp: 62, precipitation: 2.8 }, { month: 'Dec \'23', avgTemp: 54, precipitation: 4.5 }, { month: 'Jan \'24', avgTemp: 55, precipitation: 4.2 }, { month: 'Feb \'24', avgTemp: 60, precipitation: 3.5 }, { month: 'Mar \'24', avgTemp: 68, precipitation: 2.1 }, { month: 'Apr \'24', avgTemp: 75, precipitation: 1.0 }, { month: 'May \'24', avgTemp: 85, precipitation: 0.4 }, { month: 'Jun \'24', avgTemp: 92, precipitation: 0.1 },
    ],
  },
  'Bakersfield': {
    coords: { lat: 35.3733, lng: -119.0187 },
    currentAqi: { aqi: 155, pm25: 65 },
    currentWeather: { temp: 98, humidity: 23 },
    weatherForecast: [
        { day: 'Mon', temp: 99, humidity: 22 }, { day: 'Tue', temp: 102, humidity: 20 }, { day: 'Wed', temp: 105, humidity: 18 }, { day: 'Thu', temp: 104, humidity: 19 }, { day: 'Fri', temp: 101, humidity: 21 }, { day: 'Sat', temp: 98, humidity: 25 }, { day: 'Sun', temp: 99, humidity: 24 },
    ],
    dailyForecast: generateDailyForecast('Bakersfield', 365),
    historicalAqi: [
        { month: 'Jul \'23', avgAqi: 140, avgPm25: 56 }, { month: 'Aug \'23', avgAqi: 155, avgPm25: 62 }, { month: 'Sep \'23', avgAqi: 130, avgPm25: 52 }, { month: 'Oct \'23', avgAqi: 100, avgPm25: 40 }, { month: 'Nov \'23', avgAqi: 125, avgPm25: 50 }, { month: 'Dec \'23', avgAqi: 145, avgPm25: 58 }, { month: 'Jan \'24', avgAqi: 135, avgPm25: 54 }, { month: 'Feb \'24', avgAqi: 95, avgPm25: 38 }, { month: 'Mar \'24', avgAqi: 80, avgPm25: 32 }, { month: 'Apr \'24', avgAqi: 75, avgPm25: 30 }, { month: 'May \'24', avgAqi: 90, avgPm25: 36 }, { month: 'Jun \'24', avgAqi: 120, avgPm25: 48 },
    ],
    historicalWeather: [
        { month: 'Jul \'23', avgTemp: 100, precipitation: 0.05 }, { month: 'Aug \'23', avgTemp: 99, precipitation: 0.1 }, { month: 'Sep \'23', avgTemp: 91, precipitation: 0.3 }, { month: 'Oct \'23', avgTemp: 78, precipitation: 1.2 }, { month: 'Nov \'23', avgTemp: 65, precipitation: 2.5 }, { month: 'Dec \'23', avgTemp: 56, precipitation: 4.1 }, { month: 'Jan \'24', avgTemp: 57, precipitation: 3.9 }, { month: 'Feb \'24', avgTemp: 62, precipitation: 3.2 }, { month: 'Mar \'24', avgTemp: 70, precipitation: 1.9 }, { month: 'Apr \'24', avgTemp: 78, precipitation: 0.8 }, { month: 'May \'24', avgTemp: 88, precipitation: 0.3 }, { month: 'Jun \'24', avgTemp: 95, precipitation: 0.05 },
    ],
  },
  'Fresno': {
    coords: { lat: 36.7378, lng: -119.7871 },
    currentAqi: { aqi: 140, pm25: 55 },
    currentWeather: { temp: 95, humidity: 25 },
    weatherForecast: [
        { day: 'Mon', temp: 96, humidity: 24 }, { day: 'Tue', temp: 99, humidity: 21 }, { day: 'Wed', temp: 103, humidity: 19 }, { day: 'Thu', temp: 102, humidity: 20 }, { day: 'Fri', temp: 100, humidity: 23 }, { day: 'Sat', temp: 97, humidity: 27 }, { day: 'Sun', temp: 98, humidity: 25 },
    ],
    dailyForecast: generateDailyForecast('Fresno', 365),
    historicalAqi: [
        { month: 'Jul \'23', avgAqi: 135, avgPm25: 54 }, { month: 'Aug \'23', avgAqi: 150, avgPm25: 60 }, { month: 'Sep \'23', avgAqi: 125, avgPm25: 50 }, { month: 'Oct \'23', avgAqi: 95, avgPm25: 38 }, { month: 'Nov \'23', avgAqi: 120, avgPm25: 48 }, { month: 'Dec \'23', avgAqi: 140, avgPm25: 56 }, { month: 'Jan \'24', avgAqi: 130, avgPm25: 52 }, { month: 'Feb \'24', avgAqi: 90, avgPm25: 36 }, { month: 'Mar \'24', avgAqi: 75, avgPm25: 30 }, { month: 'Apr \'24', avgAqi: 70, avgPm25: 28 }, { month: 'May \'24', avgAqi: 85, avgPm25: 34 }, { month: 'Jun \'24', avgAqi: 115, avgPm25: 46 },
    ],
    historicalWeather: [
        { month: 'Jul \'23', avgTemp: 99, precipitation: 0.1 }, { month: 'Aug \'23', avgTemp: 97, precipitation: 0.2 }, { month: 'Sep \'23', avgTemp: 89, precipitation: 0.5 }, { month: 'Oct \'23', avgTemp: 76, precipitation: 1.5 }, { month: 'Nov \'23', avgTemp: 63, precipitation: 2.8 }, { month: 'Dec \'23', avgTemp: 55, precipitation: 4.5 }, { month: 'Jan \'24', avgTemp: 56, precipitation: 4.2 }, { month: 'Feb \'24', avgTemp: 61, precipitation: 3.5 }, { month: 'Mar \'24', avgTemp: 69, precipitation: 2.1 }, { month: 'Apr \'24', avgTemp: 76, precipitation: 1.0 }, { month: 'May \'24', avgTemp: 86, precipitation: 0.4 }, { month: 'Jun \'24', avgTemp: 93, precipitation: 0.1 },
    ],
  },
  'Visalia': {
    coords: { lat: 36.3302, lng: -119.2921 },
    currentAqi: { aqi: 148, pm25: 60 },
    currentWeather: { temp: 96, humidity: 24 },
    weatherForecast: [
        { day: 'Mon', temp: 96, humidity: 24 }, { day: 'Tue', temp: 99, humidity: 21 }, { day: 'Wed', temp: 103, humidity: 19 }, { day: 'Thu', temp: 102, humidity: 20 }, { day: 'Fri', temp: 100, humidity: 23 }, { day: 'Sat', temp: 97, humidity: 27 }, { day: 'Sun', temp: 98, humidity: 25 },
    ],
    dailyForecast: generateDailyForecast('Visalia', 365),
    historicalAqi: [
        { month: 'Jul \'23', avgAqi: 135, avgPm25: 54 }, { month: 'Aug \'23', avgAqi: 150, avgPm25: 60 }, { month: 'Sep \'23', avgAqi: 125, avgPm25: 50 }, { month: 'Oct \'23', avgAqi: 95, avgPm25: 38 }, { month: 'Nov \'23', avgAqi: 120, avgPm25: 48 }, { month: 'Dec \'23', avgAqi: 140, avgPm25: 56 }, { month: 'Jan \'24', avgAqi: 130, avgPm25: 52 }, { month: 'Feb \'24', avgAqi: 90, avgPm25: 36 }, { month: 'Mar \'24', avgAqi: 75, avgPm25: 30 }, { month: 'Apr \'24', avgAqi: 70, avgPm25: 28 }, { month: 'May \'24', avgAqi: 85, avgPm25: 34 }, { month: 'Jun \'24', avgAqi: 115, avgPm25: 46 },
    ],
    historicalWeather: [
        { month: 'Jul \'23', avgTemp: 99, precipitation: 0.1 }, { month: 'Aug \'23', avgTemp: 97, precipitation: 0.2 }, { month: 'Sep \'23', avgTemp: 89, precipitation: 0.5 }, { month: 'Oct \'23', avgTemp: 76, precipitation: 1.5 }, { month: 'Nov \'23', avgTemp: 63, precipitation: 2.8 }, { month: 'Dec \'23', avgTemp: 55, precipitation: 4.5 }, { month: 'Jan \'24', avgTemp: 56, precipitation: 4.2 }, { month: 'Feb \'24', avgTemp: 61, precipitation: 3.5 }, { month: 'Mar \'24', avgTemp: 69, precipitation: 2.1 }, { month: 'Apr \'24', avgTemp: 76, precipitation: 1.0 }, { month: 'May \'24', avgTemp: 86, precipitation: 0.4 }, { month: 'Jun \'24', avgTemp: 93, precipitation: 0.1 },
    ],
  },
    'Merced': {
    coords: { lat: 37.3022, lng: -120.4830 },
    currentAqi: { aqi: 110, pm25: 40 },
    currentWeather: { temp: 94, humidity: 28 },
    weatherForecast: [
        { day: 'Mon', temp: 96, humidity: 24 }, { day: 'Tue', temp: 99, humidity: 21 }, { day: 'Wed', temp: 103, humidity: 19 }, { day: 'Thu', temp: 102, humidity: 20 }, { day: 'Fri', temp: 100, humidity: 23 }, { day: 'Sat', temp: 97, humidity: 27 }, { day: 'Sun', temp: 98, humidity: 25 },
    ],
    dailyForecast: generateDailyForecast('Merced', 365),
    historicalAqi: [
        { month: 'Jul \'23', avgAqi: 135, avgPm25: 54 }, { month: 'Aug \'23', avgAqi: 150, avgPm25: 60 }, { month: 'Sep \'23', avgAqi: 125, avgPm25: 50 }, { month: 'Oct \'23', avgAqi: 95, avgPm25: 38 }, { month: 'Nov \'23', avgAqi: 120, avgPm25: 48 }, { month: 'Dec \'23', avgAqi: 140, avgPm25: 56 }, { month: 'Jan \'24', avgAqi: 130, avgPm25: 52 }, { month: 'Feb \'24', avgAqi: 90, avgPm25: 36 }, { month: 'Mar \'24', avgAqi: 75, avgPm25: 30 }, { month: 'Apr \'24', avgAqi: 70, avgPm25: 28 }, { month: 'May \'24', avgAqi: 85, avgPm25: 34 }, { month: 'Jun \'24', avgAqi: 115, avgPm25: 46 },
    ],
    historicalWeather: [
        { month: 'Jul \'23', avgTemp: 99, precipitation: 0.1 }, { month: 'Aug \'23', avgTemp: 97, precipitation: 0.2 }, { month: 'Sep \'23', avgTemp: 89, precipitation: 0.5 }, { month: 'Oct \'23', avgTemp: 76, precipitation: 1.5 }, { month: 'Nov \'23', avgTemp: 63, precipitation: 2.8 }, { month: 'Dec \'23', avgTemp: 55, precipitation: 4.5 }, { month: 'Jan \'24', avgTemp: 56, precipitation: 4.2 }, { month: 'Feb \'24', avgTemp: 61, precipitation: 3.5 }, { month: 'Mar \'24', avgTemp: 69, precipitation: 2.1 }, { month: 'Apr \'24', avgTemp: 76, precipitation: 1.0 }, { month: 'May \'24', avgTemp: 86, precipitation: 0.4 }, { month: 'Jun \'24', avgTemp: 93, precipitation: 0.1 },
    ],
  },
    'Modesto': {
    coords: { lat: 37.6391, lng: -120.9969 },
    currentAqi: { aqi: 125, pm25: 45 },
    currentWeather: { temp: 91, humidity: 32 },
    weatherForecast: [
        { day: 'Mon', temp: 92, humidity: 30 }, { day: 'Tue', temp: 94, humidity: 28 }, { day: 'Wed', temp: 97, humidity: 25 }, { day: 'Thu', temp: 96, humidity: 26 }, { day: 'Fri', temp: 94, humidity: 29 }, { day: 'Sat', temp: 91, humidity: 33 }, { day: 'Sun', temp: 92, humidity: 31 },
    ],
    dailyForecast: generateDailyForecast('Modesto', 365),
    historicalAqi: [
        { month: 'Jul \'23', avgAqi: 110, avgPm25: 44 }, { month: 'Aug \'23', avgAqi: 125, avgPm25: 50 }, { month: 'Sep \'23', avgAqi: 100, avgPm25: 40 }, { month: 'Oct \'23', avgAqi: 70, avgPm25: 28 }, { month: 'Nov \'23', avgAqi: 95, avgPm25: 38 }, { month: 'Dec \'23', avgAqi: 115, avgPm25: 46 }, { month: 'Jan \'24', avgAqi: 105, avgPm25: 42 }, { month: 'Feb \'24', avgAqi: 65, avgPm25: 26 }, { month: 'Mar \'24', avgAqi: 50, avgPm25: 20 }, { month: 'Apr \'24', avgAqi: 45, avgPm25: 18 }, { month: 'May \'24', avgAqi: 60, avgPm25: 24 }, { month: 'Jun \'24', avgAqi: 90, avgPm25: 36 },
    ],
    historicalWeather: [
        { month: 'Jul \'23', avgTemp: 94, precipitation: 0.2 }, { month: 'Aug \'23', avgTemp: 92, precipitation: 0.3 }, { month: 'Sep \'23', avgTemp: 85, precipitation: 0.8 }, { month: 'Oct \'23', avgTemp: 72, precipitation: 1.8 }, { month: 'Nov \'23', avgTemp: 59, precipitation: 3.2 }, { month: 'Dec \'23', avgTemp: 51, precipitation: 5.0 }, { month: 'Jan \'24', avgTemp: 52, precipitation: 4.8 }, { month: 'Feb \'24', avgTemp: 57, precipitation: 3.9 }, { month: 'Mar \'24', avgTemp: 65, precipitation: 2.5 }, { month: 'Apr \'24', avgTemp: 72, precipitation: 1.2 }, { month: 'May \'24', avgTemp: 81, precipitation: 0.6 }, { month: 'Jun \'24', avgTemp: 88, precipitation: 0.2 },
    ],
  },
  'Stockton': {
    coords: { lat: 37.9577, lng: -121.2908 },
    currentAqi: { aqi: 98, pm25: 35 },
    currentWeather: { temp: 90, humidity: 34 },
    weatherForecast: [
        { day: 'Mon', temp: 92, humidity: 30 }, { day: 'Tue', temp: 94, humidity: 28 }, { day: 'Wed', temp: 97, humidity: 25 }, { day: 'Thu', temp: 96, humidity: 26 }, { day: 'Fri', temp: 94, humidity: 29 }, { day: 'Sat', temp: 91, humidity: 33 }, { day: 'Sun', temp: 92, humidity: 31 },
    ],
    dailyForecast: generateDailyForecast('Stockton', 365),
    historicalAqi: [
        { month: 'Jul \'23', avgAqi: 110, avgPm25: 44 }, { month: 'Aug \'23', avgAqi: 125, avgPm25: 50 }, { month: 'Sep \'23', avgAqi: 100, avgPm25: 40 }, { month: 'Oct \'23', avgAqi: 70, avgPm25: 28 }, { month: 'Nov \'23', avgAqi: 95, avgPm25: 38 }, { month: 'Dec \'23', avgAqi: 115, avgPm25: 46 }, { month: 'Jan \'24', avgAqi: 105, avgPm25: 42 }, { month: 'Feb \'24', avgAqi: 65, avgPm25: 26 }, { month: 'Mar \'24', avgAqi: 50, avgPm25: 20 }, { month: 'Apr \'24', avgAqi: 45, avgPm25: 18 }, { month: 'May \'24', avgAqi: 60, avgPm25: 24 }, { month: 'Jun \'24', avgAqi: 90, avgPm25: 36 },
    ],
    historicalWeather: [
        { month: 'Jul \'23', avgTemp: 94, precipitation: 0.2 }, { month: 'Aug \'23', avgTemp: 92, precipitation: 0.3 }, { month: 'Sep \'23', avgTemp: 85, precipitation: 0.8 }, { month: 'Oct \'23', avgTemp: 72, precipitation: 1.8 }, { month: 'Nov \'23', avgTemp: 59, precipitation: 3.2 }, { month: 'Dec \'23', avgTemp: 51, precipitation: 5.0 }, { month: 'Jan \'24', avgTemp: 52, precipitation: 4.8 }, { month: 'Feb \'24', avgTemp: 57, precipitation: 3.9 }, { month: 'Mar \'24', avgTemp: 65, precipitation: 2.5 }, { month: 'Apr \'24', avgTemp: 72, precipitation: 1.2 }, { month: 'May \'24', avgTemp: 81, precipitation: 0.6 }, { month: 'Jun \'24', avgTemp: 88, precipitation: 0.2 },
    ],
  }
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
    'Valley Average': { baseTemp: 94, baseAqi: 130, basePm25: 52, baseHumidity: 28, elevation: 300, latitude: 36.5 },
    'Bakersfield': { baseTemp: 98, baseAqi: 155, basePm25: 65, baseHumidity: 23, elevation: 404, latitude: 35.3733 },
    'Fresno': { baseTemp: 95, baseAqi: 140, basePm25: 55, baseHumidity: 25, elevation: 308, latitude: 36.7378 },
    'Visalia': { baseTemp: 96, baseAqi: 148, basePm25: 60, baseHumidity: 24, elevation: 334, latitude: 36.3302 },
    'Merced': { baseTemp: 94, baseAqi: 110, basePm25: 40, baseHumidity: 28, elevation: 174, latitude: 37.3022 },
    'Modesto': { baseTemp: 91, baseAqi: 125, basePm25: 45, baseHumidity: 32, elevation: 91, latitude: 37.6391 },
    'Stockton': { baseTemp: 90, baseAqi: 98, basePm25: 35, baseHumidity: 34, elevation: 13, latitude: 37.9577 },
  };
  
  const params = locationParams[location] || locationParams['Valley Average'];
  
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
export const cityLocations = locations.filter(l => l !== 'Valley Average') as Exclude<LocationKey, 'Valley Average'>[];
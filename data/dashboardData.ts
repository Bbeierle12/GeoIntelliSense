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
    historicalAqi: [
        { month: 'Jul \'23', avgAqi: 110, avgPm25: 44 }, { month: 'Aug \'23', avgAqi: 125, avgPm25: 50 }, { month: 'Sep \'23', avgAqi: 100, avgPm25: 40 }, { month: 'Oct \'23', avgAqi: 70, avgPm25: 28 }, { month: 'Nov \'23', avgAqi: 95, avgPm25: 38 }, { month: 'Dec \'23', avgAqi: 115, avgPm25: 46 }, { month: 'Jan \'24', avgAqi: 105, avgPm25: 42 }, { month: 'Feb \'24', avgAqi: 65, avgPm25: 26 }, { month: 'Mar \'24', avgAqi: 50, avgPm25: 20 }, { month: 'Apr \'24', avgAqi: 45, avgPm25: 18 }, { month: 'May \'24', avgAqi: 60, avgPm25: 24 }, { month: 'Jun \'24', avgAqi: 90, avgPm25: 36 },
    ],
    historicalWeather: [
        { month: 'Jul \'23', avgTemp: 94, precipitation: 0.2 }, { month: 'Aug \'23', avgTemp: 92, precipitation: 0.3 }, { month: 'Sep \'23', avgTemp: 85, precipitation: 0.8 }, { month: 'Oct \'23', avgTemp: 72, precipitation: 1.8 }, { month: 'Nov \'23', avgTemp: 59, precipitation: 3.2 }, { month: 'Dec \'23', avgTemp: 51, precipitation: 5.0 }, { month: 'Jan \'24', avgTemp: 52, precipitation: 4.8 }, { month: 'Feb \'24', avgTemp: 57, precipitation: 3.9 }, { month: 'Mar \'24', avgTemp: 65, precipitation: 2.5 }, { month: 'Apr \'24', avgTemp: 72, precipitation: 1.2 }, { month: 'May \'24', avgTemp: 81, precipitation: 0.6 }, { month: 'Jun \'24', avgTemp: 88, precipitation: 0.2 },
    ],
  }
};


export type LocationKey = keyof typeof dashboardData;
export const locations = Object.keys(dashboardData) as LocationKey[];
export const cityLocations = locations.filter(l => l !== 'Valley Average') as Exclude<LocationKey, 'Valley Average'>[];
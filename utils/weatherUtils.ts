export function calculateFeelsLike(temp: number, humidity: number, windSpeed: number): number {
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

export function calculateET0(temp: number, humidity: number, windSpeed: number, solarRadiation: number): number {
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

export function calculateSunTimes(date: Date, latitude: number): { sunrise: string; sunset: string; dayLength: number } {
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

export function determineWeatherCondition(temp: number, precipProb: number, cloudCover: number, windSpeed: number): string {
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

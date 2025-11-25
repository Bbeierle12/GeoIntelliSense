import { useState, useMemo, useEffect, useCallback } from 'react';
import { dashboardData, LocationKey } from '../data/dashboardData';

const parseMonthString = (monthStr: string): Date => {
    const [month, year] = monthStr.replace("'", "").split(' ');
    const monthIndex = new Date(Date.parse(month +" 1, 2012")).getMonth();
    return new Date(parseInt(`20${year}`), monthIndex);
};

export const useDashboardData = () => {
  const [selectedLocations, setSelectedLocations] = useState<LocationKey[]>(['Valley Average']);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [weatherGranularity, setWeatherGranularity] = useState<'daily' | 'monthly'>('monthly');

  useEffect(() => {
    // Set default date range to the full 12 months of available data
    const sampleData = dashboardData['Valley Average'].historicalAqi;
    if (sampleData.length > 0) {
        const firstMonth = parseMonthString(sampleData[0].month);
        const lastMonth = parseMonthString(sampleData[sampleData.length - 1].month);
        const formatToInput = (date: Date) => date.toISOString().slice(0, 7);
        setStartDate(formatToInput(firstMonth));
        setEndDate(formatToInput(lastMonth));
    }
  }, []);

  const handleLocationToggle = (location: LocationKey) => {
    setSelectedLocations(prev => {
        const isSelected = prev.includes(location);
        if (isSelected) {
            if (prev.length === 1) return prev; // Don't allow unselecting the last one
            return prev.filter(l => l !== location);
        } else {
            return [...prev, location];
        }
    });
  };

  const isComparisonMode = selectedLocations.length > 1;

  const activeAlerts = useMemo(() => {
    const alerts: { name: string; aqi: number }[] = [];
    const checkedLocations = new Set<string>();

    selectedLocations.forEach(loc => {
        const locData = dashboardData[loc];
        if (!locData) return;

        if (loc === 'Valley Average' && 'regionalAqi' in locData) {
            locData.regionalAqi.forEach(city => {
                if (city.aqi > 100 && !checkedLocations.has(city.name)) {
                    alerts.push({ name: city.name, aqi: city.aqi });
                    checkedLocations.add(city.name);
                }
            });
        } else if ('currentAqi' in locData && locData.currentAqi && locData.currentAqi.aqi > 100) {
            if (!checkedLocations.has(loc)) {
                alerts.push({ name: loc, aqi: locData.currentAqi.aqi });
                checkedLocations.add(loc);
            }
        }
    });
    return alerts;
  }, [selectedLocations]);

  // Merged forecast data
  const mergedForecastData = useMemo(() => {
    const dayMap = new Map<string, Record<string, any>>();
    selectedLocations.forEach(loc => {
        const locEntry = dashboardData[loc];
        if (locEntry && 'weatherForecast' in locEntry) {
            const locData = locEntry.weatherForecast;
            locData.forEach(dataPoint => {
                if (!dayMap.has(dataPoint.day)) {
                    dayMap.set(dataPoint.day, { day: dataPoint.day });
                }
                const entry = dayMap.get(dataPoint.day)!;
                entry[`${loc}_temp`] = dataPoint.temp;
                entry[`${loc}_humidity`] = dataPoint.humidity;
            });
        }
    });
    const dayOrder = dashboardData['Valley Average'].weatherForecast.map(d => d.day);
    return dayOrder.map(day => dayMap.get(day)).filter(Boolean);
  }, [selectedLocations]);

  const getFilteredHistoricalData = useCallback((dataType: 'historicalAqi' | 'historicalWeather') => {
    if (!startDate || !endDate) return { filteredMonthOrder: [] };

    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setMonth(end.getMonth() + 1, 0); // Set to last day of month to be inclusive

    const allMonths = dashboardData['Valley Average'][dataType].map(d => d.month);
    const filteredMonthOrder = allMonths.filter(monthStr => {
        const date = parseMonthString(monthStr);
        return date >= start && date <= end;
    });

    return { filteredMonthOrder };
  }, [startDate, endDate]);

  const mergedHistoricalAqi = useMemo(() => {
    const { filteredMonthOrder } = getFilteredHistoricalData('historicalAqi');
    if (filteredMonthOrder.length === 0) return [];

    const monthMap = new Map<string, Record<string, any>>();
    selectedLocations.forEach(loc => {
        const locEntry = dashboardData[loc];
        if (locEntry && 'historicalAqi' in locEntry) {
            const locData = locEntry.historicalAqi;
            locData.forEach(dataPoint => {
                if (!monthMap.has(dataPoint.month)) {
                    monthMap.set(dataPoint.month, { month: dataPoint.month });
                }
                monthMap.get(dataPoint.month)![loc] = dataPoint.avgAqi;
            });
        }
    });
    return filteredMonthOrder.map(month => monthMap.get(month)).filter(Boolean);
  }, [selectedLocations, getFilteredHistoricalData]);

  const mergedHistoricalPm25 = useMemo(() => {
    const { filteredMonthOrder } = getFilteredHistoricalData('historicalAqi');
    if (filteredMonthOrder.length === 0) return [];

    const monthMap = new Map<string, Record<string, any>>();
    selectedLocations.forEach(loc => {
        const locEntry = dashboardData[loc];
        if (locEntry && 'historicalAqi' in locEntry) {
            const locData = locEntry.historicalAqi;
            locData.forEach(dataPoint => {
                if (!monthMap.has(dataPoint.month)) {
                    monthMap.set(dataPoint.month, { month: dataPoint.month });
                }
                monthMap.get(dataPoint.month)![loc] = dataPoint.avgPm25;
            });
        }
    });
    return filteredMonthOrder.map(month => monthMap.get(month)).filter(Boolean);
  }, [selectedLocations, getFilteredHistoricalData]);

  const mergedHistoricalWeather = useMemo(() => {
    const { filteredMonthOrder } = getFilteredHistoricalData('historicalWeather');
    if (filteredMonthOrder.length === 0) return [];

    const monthMap = new Map<string, Record<string, any>>();
    selectedLocations.forEach(loc => {
        const locEntry = dashboardData[loc];
        if (locEntry && 'historicalWeather' in locEntry) {
            const locData = locEntry.historicalWeather;
            locData.forEach(dataPoint => {
                if (!monthMap.has(dataPoint.month)) {
                    monthMap.set(dataPoint.month, { month: dataPoint.month });
                }
                const entry = monthMap.get(dataPoint.month)!;
                entry[`${loc}_temp`] = dataPoint.avgTemp;
                entry[`${loc}_precip`] = dataPoint.precipitation;
            });
        }
    });
    return filteredMonthOrder.map(month => monthMap.get(month)).filter(Boolean);
  }, [selectedLocations, getFilteredHistoricalData]);

  // Humidity trends data
  const mergedHumidityData = useMemo(() => {
    if (weatherGranularity === 'monthly') {
      if (!startDate || !endDate) return [];
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setMonth(end.getMonth() + 1, 0);

      const monthMap = new Map<string, Record<string, { sum: number; count: number }>>();

      selectedLocations.forEach(loc => {
        const locEntry = dashboardData[loc];
        if (locEntry && 'dailyForecast' in locEntry) {
          locEntry.dailyForecast.forEach((day: any) => {
            const dayDate = new Date(day.date);
            if (dayDate >= start && dayDate <= end) {
              const monthKey = `${dayDate.toLocaleDateString('en-US', { month: 'short' })} '${dayDate.getFullYear().toString().slice(-2)}`;
              if (!monthMap.has(monthKey)) {
                monthMap.set(monthKey, {});
              }
              const monthData = monthMap.get(monthKey)!;
              if (!monthData[loc]) {
                monthData[loc] = { sum: 0, count: 0 };
              }
              monthData[loc].sum += day.humidity;
              monthData[loc].count += 1;
            }
          });
        }
      });

      const result: any[] = [];
      monthMap.forEach((locData, month) => {
        const entry: any = { month };
        Object.keys(locData).forEach(loc => {
          entry[loc] = Math.round(locData[loc].sum / locData[loc].count);
        });
        result.push(entry);
      });
      return result;
    }
    return [];
  }, [selectedLocations, startDate, endDate, weatherGranularity]);

  // Wind speed trends data
  const mergedWindData = useMemo(() => {
    if (weatherGranularity === 'monthly') {
      if (!startDate || !endDate) return [];
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setMonth(end.getMonth() + 1, 0);

      const monthMap = new Map<string, Record<string, { sum: number; count: number }>>();

      selectedLocations.forEach(loc => {
        const locEntry = dashboardData[loc];
        if (locEntry && 'dailyForecast' in locEntry) {
          locEntry.dailyForecast.forEach((day: any) => {
            const dayDate = new Date(day.date);
            if (dayDate >= start && dayDate <= end) {
              const monthKey = `${dayDate.toLocaleDateString('en-US', { month: 'short' })} '${dayDate.getFullYear().toString().slice(-2)}`;
              if (!monthMap.has(monthKey)) {
                monthMap.set(monthKey, {});
              }
              const monthData = monthMap.get(monthKey)!;
              if (!monthData[loc]) {
                monthData[loc] = { sum: 0, count: 0 };
              }
              monthData[loc].sum += day.wind.speed;
              monthData[loc].count += 1;
            }
          });
        }
      });

      const result: any[] = [];
      monthMap.forEach((locData, month) => {
        const entry: any = { month };
        Object.keys(locData).forEach(loc => {
          entry[loc] = Math.round((locData[loc].sum / locData[loc].count) * 10) / 10;
        });
        result.push(entry);
      });
      return result;
    }
    return [];
  }, [selectedLocations, startDate, endDate, weatherGranularity]);

  // UV index trends data
  const mergedUVData = useMemo(() => {
    if (weatherGranularity === 'monthly') {
      if (!startDate || !endDate) return [];
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setMonth(end.getMonth() + 1, 0);

      const monthMap = new Map<string, Record<string, { max: number; count: number }>>();

      selectedLocations.forEach(loc => {
        const locEntry = dashboardData[loc];
        if (locEntry && 'dailyForecast' in locEntry) {
          locEntry.dailyForecast.forEach((day: any) => {
            const dayDate = new Date(day.date);
            if (dayDate >= start && dayDate <= end) {
              const monthKey = `${dayDate.toLocaleDateString('en-US', { month: 'short' })} '${dayDate.getFullYear().toString().slice(-2)}`;
              if (!monthMap.has(monthKey)) {
                monthMap.set(monthKey, {});
              }
              const monthData = monthMap.get(monthKey)!;
              if (!monthData[loc]) {
                monthData[loc] = { max: 0, count: 0 };
              }
              monthData[loc].max = Math.max(monthData[loc].max, day.uv);
              monthData[loc].count += 1;
            }
          });
        }
      });

      const result: any[] = [];
      monthMap.forEach((locData, month) => {
        const entry: any = { month };
        Object.keys(locData).forEach(loc => {
          entry[loc] = locData[loc].max;
        });
        result.push(entry);
      });
      return result;
    }
    return [];
  }, [selectedLocations, startDate, endDate, weatherGranularity]);

  // Agricultural metrics data
  const mergedAgriculturalData = useMemo(() => {
    if (weatherGranularity === 'monthly') {
      if (!startDate || !endDate) return [];
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setMonth(end.getMonth() + 1, 0);

      const monthMap = new Map<string, Record<string, { et0Sum: number; solarSum: number; count: number }>>();

      selectedLocations.forEach(loc => {
        const locEntry = dashboardData[loc];
        if (locEntry && 'dailyForecast' in locEntry) {
          locEntry.dailyForecast.forEach((day: any) => {
            const dayDate = new Date(day.date);
            if (dayDate >= start && dayDate <= end) {
              const monthKey = `${dayDate.toLocaleDateString('en-US', { month: 'short' })} '${dayDate.getFullYear().toString().slice(-2)}`;
              if (!monthMap.has(monthKey)) {
                monthMap.set(monthKey, {});
              }
              const monthData = monthMap.get(monthKey)!;
              if (!monthData[loc]) {
                monthData[loc] = { et0Sum: 0, solarSum: 0, count: 0 };
              }
              monthData[loc].et0Sum += day.evapotranspiration;
              monthData[loc].solarSum += day.solarRadiation;
              monthData[loc].count += 1;
            }
          });
        }
      });

      const result: any[] = [];
      monthMap.forEach((locData, month) => {
        const entry: any = { month };
        Object.keys(locData).forEach(loc => {
          entry[`${loc}_et0`] = Math.round((locData[loc].et0Sum / locData[loc].count) * 10) / 10;
          entry[`${loc}_solar`] = Math.round(locData[loc].solarSum / locData[loc].count);
        });
        result.push(entry);
      });
      return result;
    }
    return [];
  }, [selectedLocations, startDate, endDate, weatherGranularity]);

  return {
    // State
    selectedLocations,
    setSelectedLocations,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    weatherGranularity,
    setWeatherGranularity,
    isComparisonMode,

    // Actions
    handleLocationToggle,

    // Computed data
    activeAlerts,
    mergedForecastData,
    mergedHistoricalAqi,
    mergedHistoricalPm25,
    mergedHistoricalWeather,
    mergedHumidityData,
    mergedWindData,
    mergedUVData,
    mergedAgriculturalData
  };
};
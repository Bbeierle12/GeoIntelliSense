import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { LocationKey } from '../data/dashboardData';
import { 
  TemperatureUnit, 
  WindSpeedUnit, 
  PressureUnit, 
  FontSize, 
  RefreshInterval,
  AnalysisTool 
} from '../types';

export type Theme = 'dark' | 'light' | 'system';

export interface DateRange {
  start: string;
  end: string;
}

export interface NotificationSettings {
  enabled: boolean;
  aqiAlertThreshold: number;
  temperatureAlertHigh: number;
  temperatureAlertLow: number;
  soundEnabled: boolean;
}

export interface AccessibilitySettings {
  fontSize: FontSize;
  reducedMotion: boolean;
  highContrast: boolean;
  screenReaderAnnouncements: 'minimal' | 'normal' | 'verbose';
}

export interface DataSettings {
  temperatureUnit: TemperatureUnit;
  windSpeedUnit: WindSpeedUnit;
  pressureUnit: PressureUnit;
  refreshInterval: RefreshInterval;
  defaultDateRangeDays: number;
}

export interface AnalysisSettings {
  defaultTool: AnalysisTool;
  showExperimentalFeatures: boolean;
}

export interface UserPreferences {
  // Appearance
  theme: Theme;
  
  // Locations
  selectedLocations: LocationKey[];
  dateRange: DateRange | null;
  mapZoomLevel: number;
  mapCenter: { lat: number; lng: number } | null;
  
  // UI State
  sidebarExpanded: boolean;
  
  // Data & Units
  dataSettings: DataSettings;
  
  // Notifications
  notifications: NotificationSettings;
  
  // Accessibility
  accessibility: AccessibilitySettings;
  
  // Analysis
  analysis: AnalysisSettings;
}

interface UserPreferencesContextType {
  preferences: UserPreferences;
  updatePreferences: (updates: Partial<UserPreferences>) => void;
  updateDataSettings: (updates: Partial<DataSettings>) => void;
  updateNotifications: (updates: Partial<NotificationSettings>) => void;
  updateAccessibility: (updates: Partial<AccessibilitySettings>) => void;
  updateAnalysis: (updates: Partial<AnalysisSettings>) => void;
  resetPreferences: () => void;
  toggleTheme: () => void;
  toggleLocation: (location: LocationKey) => void;
  exportPreferences: () => string;
  importPreferences: (json: string) => boolean;
  getEffectiveTheme: () => 'dark' | 'light';
}

const defaultDataSettings: DataSettings = {
  temperatureUnit: 'fahrenheit',
  windSpeedUnit: 'mph',
  pressureUnit: 'inHg',
  refreshInterval: 15,
  defaultDateRangeDays: 7,
};

const defaultNotifications: NotificationSettings = {
  enabled: false,
  aqiAlertThreshold: 100,
  temperatureAlertHigh: 100,
  temperatureAlertLow: 32,
  soundEnabled: false,
};

const defaultAccessibility: AccessibilitySettings = {
  fontSize: 'medium',
  reducedMotion: false,
  highContrast: false,
  screenReaderAnnouncements: 'normal',
};

const defaultAnalysis: AnalysisSettings = {
  defaultTool: 'quick',
  showExperimentalFeatures: false,
};

const defaultPreferences: UserPreferences = {
  theme: 'dark',
  selectedLocations: ['Fresno', 'Bakersfield', 'Stockton'],
  dateRange: null,
  mapZoomLevel: 8,
  mapCenter: { lat: 37.0902, lng: -120.7129 }, // San Joaquin Valley center
  sidebarExpanded: true,
  dataSettings: defaultDataSettings,
  notifications: defaultNotifications,
  accessibility: defaultAccessibility,
  analysis: defaultAnalysis,
};

const UserPreferencesContext = createContext<UserPreferencesContextType | undefined>(undefined);

const STORAGE_KEY = 'geoIntelliSense_userPreferences';

export const UserPreferencesProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [preferences, setPreferences] = useState<UserPreferences>(() => {
    // Load preferences from localStorage on initial mount
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Deep merge with defaults to handle new settings added in updates
        return {
          ...defaultPreferences,
          ...parsed,
          dataSettings: { ...defaultDataSettings, ...parsed.dataSettings },
          notifications: { ...defaultNotifications, ...parsed.notifications },
          accessibility: { ...defaultAccessibility, ...parsed.accessibility },
          analysis: { ...defaultAnalysis, ...parsed.analysis },
        };
      }
    } catch (error) {
      console.error('Failed to load user preferences:', error);
    }
    return defaultPreferences;
  });

  // Get effective theme (resolves 'system' to actual theme)
  const getEffectiveTheme = useCallback((): 'dark' | 'light' => {
    if (preferences.theme === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return preferences.theme;
  }, [preferences.theme]);

  // Save preferences to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    } catch (error) {
      console.error('Failed to save user preferences:', error);
    }
  }, [preferences]);

  // Apply theme class to document root
  useEffect(() => {
    const effectiveTheme = getEffectiveTheme();
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(effectiveTheme);
  }, [preferences.theme, getEffectiveTheme]);

  // Listen for system theme changes when using 'system' theme
  useEffect(() => {
    if (preferences.theme !== 'system') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      const effectiveTheme = mediaQuery.matches ? 'dark' : 'light';
      document.documentElement.classList.remove('light', 'dark');
      document.documentElement.classList.add(effectiveTheme);
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [preferences.theme]);

  // Apply accessibility settings
  useEffect(() => {
    const root = document.documentElement;
    
    // Font size
    root.classList.remove('font-small', 'font-medium', 'font-large');
    root.classList.add(`font-${preferences.accessibility.fontSize}`);
    
    // Reduced motion
    if (preferences.accessibility.reducedMotion) {
      root.classList.add('reduce-motion');
    } else {
      root.classList.remove('reduce-motion');
    }
    
    // High contrast
    if (preferences.accessibility.highContrast) {
      root.classList.add('high-contrast');
    } else {
      root.classList.remove('high-contrast');
    }
  }, [preferences.accessibility]);

  const updatePreferences = (updates: Partial<UserPreferences>) => {
    setPreferences((prev) => ({ ...prev, ...updates }));
  };

  const updateDataSettings = (updates: Partial<DataSettings>) => {
    setPreferences((prev) => ({
      ...prev,
      dataSettings: { ...prev.dataSettings, ...updates },
    }));
  };

  const updateNotifications = (updates: Partial<NotificationSettings>) => {
    setPreferences((prev) => ({
      ...prev,
      notifications: { ...prev.notifications, ...updates },
    }));
  };

  const updateAccessibility = (updates: Partial<AccessibilitySettings>) => {
    setPreferences((prev) => ({
      ...prev,
      accessibility: { ...prev.accessibility, ...updates },
    }));
  };

  const updateAnalysis = (updates: Partial<AnalysisSettings>) => {
    setPreferences((prev) => ({
      ...prev,
      analysis: { ...prev.analysis, ...updates },
    }));
  };

  const resetPreferences = () => {
    setPreferences(defaultPreferences);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      console.error('Failed to clear user preferences:', error);
    }
  };

  const toggleTheme = () => {
    setPreferences((prev) => {
      // Cycle through: dark -> light -> system -> dark
      const themeOrder: Theme[] = ['dark', 'light', 'system'];
      const currentIndex = themeOrder.indexOf(prev.theme);
      const nextTheme = themeOrder[(currentIndex + 1) % themeOrder.length];
      return { ...prev, theme: nextTheme };
    });
  };

  const toggleLocation = (location: LocationKey) => {
    setPreferences((prev) => {
      const locations = prev.selectedLocations.includes(location)
        ? prev.selectedLocations.filter((loc) => loc !== location)
        : [...prev.selectedLocations, location];

      // Ensure at least one location is always selected
      if (locations.length === 0) {
        return prev;
      }

      return { ...prev, selectedLocations: locations };
    });
  };

  const exportPreferences = (): string => {
    return JSON.stringify(preferences, null, 2);
  };

  const importPreferences = (json: string): boolean => {
    try {
      const imported = JSON.parse(json);
      // Validate and merge with defaults
      const merged: UserPreferences = {
        ...defaultPreferences,
        ...imported,
        dataSettings: { ...defaultDataSettings, ...imported.dataSettings },
        notifications: { ...defaultNotifications, ...imported.notifications },
        accessibility: { ...defaultAccessibility, ...imported.accessibility },
        analysis: { ...defaultAnalysis, ...imported.analysis },
      };
      setPreferences(merged);
      return true;
    } catch (error) {
      console.error('Failed to import preferences:', error);
      return false;
    }
  };

  const contextValue: UserPreferencesContextType = {
    preferences,
    updatePreferences,
    updateDataSettings,
    updateNotifications,
    updateAccessibility,
    updateAnalysis,
    resetPreferences,
    toggleTheme,
    toggleLocation,
    exportPreferences,
    importPreferences,
    getEffectiveTheme,
  };

  return (
    <UserPreferencesContext.Provider value={contextValue}>
      {children}
    </UserPreferencesContext.Provider>
  );
};

// Custom hook for using the context
export const useUserPreferences = (): UserPreferencesContextType => {
  const context = useContext(UserPreferencesContext);
  if (!context) {
    throw new Error('useUserPreferences must be used within a UserPreferencesProvider');
  }
  return context;
};
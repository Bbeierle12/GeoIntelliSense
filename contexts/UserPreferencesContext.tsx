import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { LocationKey } from '../data/dashboardData';

export type Theme = 'dark' | 'light';

export interface DateRange {
  start: string;
  end: string;
}

export interface UserPreferences {
  theme: Theme;
  selectedLocations: LocationKey[];
  dateRange: DateRange | null;
  mapZoomLevel: number;
  mapCenter: { lat: number; lng: number } | null;
  sidebarExpanded: boolean;
}

interface UserPreferencesContextType {
  preferences: UserPreferences;
  updatePreferences: (updates: Partial<UserPreferences>) => void;
  resetPreferences: () => void;
  toggleTheme: () => void;
  toggleLocation: (location: LocationKey) => void;
}

const defaultPreferences: UserPreferences = {
  theme: 'dark',
  selectedLocations: ['Fresno', 'Bakersfield', 'Stockton'],
  dateRange: null,
  mapZoomLevel: 8,
  mapCenter: { lat: 37.0902, lng: -120.7129 }, // San Joaquin Valley center
  sidebarExpanded: true,
};

const UserPreferencesContext = createContext<UserPreferencesContextType | undefined>(undefined);

const STORAGE_KEY = 'geoIntelliSense_userPreferences';

export const UserPreferencesProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [preferences, setPreferences] = useState<UserPreferences>(() => {
    // Load preferences from localStorage on initial mount
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        return { ...defaultPreferences, ...JSON.parse(stored) };
      }
    } catch (error) {
      console.error('Failed to load user preferences:', error);
    }
    return defaultPreferences;
  });

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
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(preferences.theme);
  }, [preferences.theme]);

  const updatePreferences = (updates: Partial<UserPreferences>) => {
    setPreferences((prev) => ({ ...prev, ...updates }));
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
    setPreferences((prev) => ({
      ...prev,
      theme: prev.theme === 'dark' ? 'light' : 'dark',
    }));
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

  const contextValue: UserPreferencesContextType = {
    preferences,
    updatePreferences,
    resetPreferences,
    toggleTheme,
    toggleLocation,
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
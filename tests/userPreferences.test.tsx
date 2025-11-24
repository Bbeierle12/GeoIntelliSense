/**
 * User Preferences Context Tests for GeoIntelliSense
 * 
 * These tests verify that:
 * - Theme toggle between dark/light modes works correctly
 * - localStorage persistence works properly
 * - Location selection/deselection functions correctly
 * - At least one location must always be selected
 * - Date range updates work properly
 * - Map settings (zoom level, center) persist
 * - resetPreferences returns to defaults
 * - Context throws error when used outside provider
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { 
  UserPreferencesProvider, 
  useUserPreferences,
  type UserPreferences,
  type Theme,
} from '../contexts/UserPreferencesContext';

// Helper wrapper for renderHook
const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <UserPreferencesProvider>{children}</UserPreferencesProvider>
);

// Storage key used by the context
const STORAGE_KEY = 'geoIntelliSense_userPreferences';

describe('User Preferences Context Tests', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
    vi.clearAllMocks();
    // Reset document class list
    document.documentElement.classList.remove('light', 'dark');
  });

  describe('Default Preferences', () => {
    it('should have correct default theme (dark)', () => {
      const { result } = renderHook(() => useUserPreferences(), { wrapper });
      
      expect(result.current.preferences.theme).toBe('dark');
    });

    it('should have correct default selected locations', () => {
      const { result } = renderHook(() => useUserPreferences(), { wrapper });
      
      expect(result.current.preferences.selectedLocations).toEqual(['Fresno', 'Bakersfield', 'Stockton']);
    });

    it('should have correct default map zoom level', () => {
      const { result } = renderHook(() => useUserPreferences(), { wrapper });
      
      expect(result.current.preferences.mapZoomLevel).toBe(8);
    });

    it('should have correct default map center (San Joaquin Valley)', () => {
      const { result } = renderHook(() => useUserPreferences(), { wrapper });
      
      expect(result.current.preferences.mapCenter).toEqual({ lat: 37.0902, lng: -120.7129 });
    });

    it('should have null dateRange by default', () => {
      const { result } = renderHook(() => useUserPreferences(), { wrapper });
      
      expect(result.current.preferences.dateRange).toBeNull();
    });

    it('should have sidebarExpanded set to true by default', () => {
      const { result } = renderHook(() => useUserPreferences(), { wrapper });
      
      expect(result.current.preferences.sidebarExpanded).toBe(true);
    });
  });

  describe('Theme Toggle', () => {
    it('should toggle theme from dark to light', () => {
      const { result } = renderHook(() => useUserPreferences(), { wrapper });
      
      expect(result.current.preferences.theme).toBe('dark');
      
      act(() => {
        result.current.toggleTheme();
      });
      
      expect(result.current.preferences.theme).toBe('light');
    });

    it('should toggle theme from light to dark', () => {
      const { result } = renderHook(() => useUserPreferences(), { wrapper });
      
      // First toggle to light
      act(() => {
        result.current.toggleTheme();
      });
      
      expect(result.current.preferences.theme).toBe('light');
      
      // Then toggle back to dark
      act(() => {
        result.current.toggleTheme();
      });
      
      expect(result.current.preferences.theme).toBe('dark');
    });

    it('should apply theme class to document root', () => {
      const { result } = renderHook(() => useUserPreferences(), { wrapper });
      
      // Initial dark theme
      expect(document.documentElement.classList.contains('dark')).toBe(true);
      
      act(() => {
        result.current.toggleTheme();
      });
      
      expect(document.documentElement.classList.contains('light')).toBe(true);
      expect(document.documentElement.classList.contains('dark')).toBe(false);
    });

    it('should remove previous theme class when toggling', () => {
      const { result } = renderHook(() => useUserPreferences(), { wrapper });
      
      act(() => {
        result.current.toggleTheme();
      });
      
      // After toggling to light, dark class should be removed
      expect(document.documentElement.classList.contains('dark')).toBe(false);
      expect(document.documentElement.classList.contains('light')).toBe(true);
    });
  });

  describe('localStorage Persistence', () => {
    it('should save preferences to localStorage when theme changes', () => {
      const { result } = renderHook(() => useUserPreferences(), { wrapper });
      
      act(() => {
        result.current.toggleTheme();
      });
      
      const stored = localStorage.getItem(STORAGE_KEY);
      expect(stored).not.toBeNull();
      
      const parsed = JSON.parse(stored!);
      expect(parsed.theme).toBe('light');
    });

    it('should load preferences from localStorage on mount', () => {
      // Pre-populate localStorage with custom preferences
      const customPreferences: Partial<UserPreferences> = {
        theme: 'light' as Theme,
        mapZoomLevel: 12,
        selectedLocations: ['Fresno'],
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(customPreferences));
      
      const { result } = renderHook(() => useUserPreferences(), { wrapper });
      
      expect(result.current.preferences.theme).toBe('light');
      expect(result.current.preferences.mapZoomLevel).toBe(12);
      expect(result.current.preferences.selectedLocations).toEqual(['Fresno']);
    });

    it('should merge stored preferences with defaults', () => {
      // Store only partial preferences
      const partialPreferences = {
        theme: 'light' as Theme,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(partialPreferences));
      
      const { result } = renderHook(() => useUserPreferences(), { wrapper });
      
      // Should have the stored theme
      expect(result.current.preferences.theme).toBe('light');
      // But also the default values for other properties
      expect(result.current.preferences.mapZoomLevel).toBe(8);
      expect(result.current.preferences.selectedLocations).toEqual(['Fresno', 'Bakersfield', 'Stockton']);
    });

    it('should handle corrupted localStorage data gracefully', () => {
      // Store invalid JSON
      localStorage.setItem(STORAGE_KEY, 'not valid json');
      
      // Should not throw and should use defaults
      const { result } = renderHook(() => useUserPreferences(), { wrapper });
      
      expect(result.current.preferences.theme).toBe('dark');
    });
  });

  describe('Location Selection', () => {
    it('should toggle location selection (add new location)', () => {
      const { result } = renderHook(() => useUserPreferences(), { wrapper });
      
      // Initial locations: ['Fresno', 'Bakersfield', 'Stockton']
      expect(result.current.preferences.selectedLocations).not.toContain('Modesto');
      
      act(() => {
        result.current.toggleLocation('Modesto');
      });
      
      expect(result.current.preferences.selectedLocations).toContain('Modesto');
    });

    it('should toggle location selection (remove existing location)', () => {
      const { result } = renderHook(() => useUserPreferences(), { wrapper });
      
      // Initial locations: ['Fresno', 'Bakersfield', 'Stockton']
      expect(result.current.preferences.selectedLocations).toContain('Fresno');
      
      act(() => {
        result.current.toggleLocation('Fresno');
      });
      
      expect(result.current.preferences.selectedLocations).not.toContain('Fresno');
    });

    it('should not allow deselecting the last location', () => {
      // Start with only one location
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ selectedLocations: ['Fresno'] }));
      
      const { result } = renderHook(() => useUserPreferences(), { wrapper });
      
      expect(result.current.preferences.selectedLocations).toHaveLength(1);
      
      act(() => {
        result.current.toggleLocation('Fresno');
      });
      
      // Should still have Fresno selected
      expect(result.current.preferences.selectedLocations).toHaveLength(1);
      expect(result.current.preferences.selectedLocations).toContain('Fresno');
    });

    it('should allow deselecting locations when more than one is selected', () => {
      const { result } = renderHook(() => useUserPreferences(), { wrapper });
      
      // Initial: ['Fresno', 'Bakersfield', 'Stockton'] (3 locations)
      act(() => {
        result.current.toggleLocation('Fresno');
      });
      
      // Should have 2 locations now
      expect(result.current.preferences.selectedLocations).toHaveLength(2);
      expect(result.current.preferences.selectedLocations).not.toContain('Fresno');
    });

    it('should preserve order when adding locations', () => {
      const { result } = renderHook(() => useUserPreferences(), { wrapper });
      
      const initialLocations = [...result.current.preferences.selectedLocations];
      
      act(() => {
        result.current.toggleLocation('Modesto');
      });
      
      // New location should be added at the end
      expect(result.current.preferences.selectedLocations.slice(0, -1)).toEqual(initialLocations);
      expect(result.current.preferences.selectedLocations[result.current.preferences.selectedLocations.length - 1]).toBe('Modesto');
    });
  });

  describe('Update Preferences', () => {
    it('should update mapZoomLevel', () => {
      const { result } = renderHook(() => useUserPreferences(), { wrapper });
      
      act(() => {
        result.current.updatePreferences({ mapZoomLevel: 15 });
      });
      
      expect(result.current.preferences.mapZoomLevel).toBe(15);
    });

    it('should update mapCenter', () => {
      const { result } = renderHook(() => useUserPreferences(), { wrapper });
      const newCenter = { lat: 36.5, lng: -120.0 };
      
      act(() => {
        result.current.updatePreferences({ mapCenter: newCenter });
      });
      
      expect(result.current.preferences.mapCenter).toEqual(newCenter);
    });

    it('should update dateRange', () => {
      const { result } = renderHook(() => useUserPreferences(), { wrapper });
      const newDateRange = { start: '2024-01-01', end: '2024-12-31' };
      
      act(() => {
        result.current.updatePreferences({ dateRange: newDateRange });
      });
      
      expect(result.current.preferences.dateRange).toEqual(newDateRange);
    });

    it('should update sidebarExpanded', () => {
      const { result } = renderHook(() => useUserPreferences(), { wrapper });
      
      act(() => {
        result.current.updatePreferences({ sidebarExpanded: false });
      });
      
      expect(result.current.preferences.sidebarExpanded).toBe(false);
    });

    it('should update multiple preferences at once', () => {
      const { result } = renderHook(() => useUserPreferences(), { wrapper });
      
      act(() => {
        result.current.updatePreferences({
          mapZoomLevel: 10,
          sidebarExpanded: false,
          theme: 'light',
        });
      });
      
      expect(result.current.preferences.mapZoomLevel).toBe(10);
      expect(result.current.preferences.sidebarExpanded).toBe(false);
      expect(result.current.preferences.theme).toBe('light');
    });

    it('should persist updated preferences to localStorage', () => {
      const { result } = renderHook(() => useUserPreferences(), { wrapper });
      
      act(() => {
        result.current.updatePreferences({ mapZoomLevel: 10 });
      });
      
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
      expect(stored.mapZoomLevel).toBe(10);
    });
  });

  describe('Reset Preferences', () => {
    it('should reset all preferences to defaults', () => {
      const { result } = renderHook(() => useUserPreferences(), { wrapper });
      
      // Modify several preferences
      act(() => {
        result.current.toggleTheme();
        result.current.updatePreferences({ mapZoomLevel: 15 });
        result.current.toggleLocation('Modesto');
      });
      
      expect(result.current.preferences.theme).toBe('light');
      expect(result.current.preferences.mapZoomLevel).toBe(15);
      expect(result.current.preferences.selectedLocations).toContain('Modesto');
      
      // Reset
      act(() => {
        result.current.resetPreferences();
      });
      
      // Verify defaults
      expect(result.current.preferences.theme).toBe('dark');
      expect(result.current.preferences.mapZoomLevel).toBe(8);
      expect(result.current.preferences.selectedLocations).toEqual(['Fresno', 'Bakersfield', 'Stockton']);
    });

    it('should clear localStorage on reset', () => {
      const { result } = renderHook(() => useUserPreferences(), { wrapper });
      
      act(() => {
        result.current.toggleTheme();
      });
      
      expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
      
      act(() => {
        result.current.resetPreferences();
      });
      
      // Note: After reset, the useEffect will save the defaults to localStorage,
      // so we check for default values rather than null
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
      expect(stored.theme).toBe('dark');
    });
  });

  describe('Context Error Handling', () => {
    it('should throw error when useUserPreferences is used outside provider', () => {
      // Suppress console.error for this test
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      expect(() => {
        renderHook(() => useUserPreferences());
      }).toThrow('useUserPreferences must be used within a UserPreferencesProvider');
      
      consoleSpy.mockRestore();
    });
  });

  describe('Component Integration', () => {
    const TestComponent: React.FC = () => {
      const { preferences, toggleTheme, toggleLocation, resetPreferences } = useUserPreferences();
      
      return (
        <div>
          <span data-testid="theme">{preferences.theme}</span>
          <span data-testid="locations">{preferences.selectedLocations.join(',')}</span>
          <span data-testid="zoom">{preferences.mapZoomLevel}</span>
          <button onClick={toggleTheme} data-testid="toggle-theme">Toggle Theme</button>
          <button onClick={() => toggleLocation('Modesto')} data-testid="toggle-modesto">Toggle Modesto</button>
          <button onClick={resetPreferences} data-testid="reset">Reset</button>
        </div>
      );
    };

    it('should work correctly in a component', async () => {
      const user = userEvent.setup();
      
      render(
        <UserPreferencesProvider>
          <TestComponent />
        </UserPreferencesProvider>
      );
      
      expect(screen.getByTestId('theme')).toHaveTextContent('dark');
      
      await user.click(screen.getByTestId('toggle-theme'));
      
      expect(screen.getByTestId('theme')).toHaveTextContent('light');
    });

    it('should update locations via component', async () => {
      const user = userEvent.setup();
      
      render(
        <UserPreferencesProvider>
          <TestComponent />
        </UserPreferencesProvider>
      );
      
      expect(screen.getByTestId('locations')).not.toHaveTextContent('Modesto');
      
      await user.click(screen.getByTestId('toggle-modesto'));
      
      expect(screen.getByTestId('locations')).toHaveTextContent('Modesto');
    });

    it('should reset via component', async () => {
      const user = userEvent.setup();
      
      render(
        <UserPreferencesProvider>
          <TestComponent />
        </UserPreferencesProvider>
      );
      
      // Change theme
      await user.click(screen.getByTestId('toggle-theme'));
      expect(screen.getByTestId('theme')).toHaveTextContent('light');
      
      // Reset
      await user.click(screen.getByTestId('reset'));
      expect(screen.getByTestId('theme')).toHaveTextContent('dark');
    });
  });
});

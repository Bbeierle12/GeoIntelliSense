/**
 * Accessibility utilities for GeoIntelliSense
 * Provides keyboard navigation, skip links, focus management, and screen reader support
 */

import React, { useEffect, useCallback, useRef, useState } from 'react';

/**
 * Keyboard shortcut configuration
 */
export interface KeyboardShortcut {
  key: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  action: () => void;
  description: string;
}

/**
 * Hook for managing keyboard shortcuts
 */
export function useKeyboardShortcuts(shortcuts: KeyboardShortcut[]): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs
      const target = event.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      ) {
        return;
      }

      for (const shortcut of shortcuts) {
        const keyMatches = event.key.toLowerCase() === shortcut.key.toLowerCase();
        const ctrlMatches = shortcut.ctrlKey ? event.ctrlKey : !event.ctrlKey;
        const altMatches = shortcut.altKey ? event.altKey : !event.altKey;
        const shiftMatches = shortcut.shiftKey ? event.shiftKey : !event.shiftKey;

        if (keyMatches && ctrlMatches && altMatches && shiftMatches) {
          event.preventDefault();
          shortcut.action();
          return;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [shortcuts]);
}

/**
 * Hook for focus trap within a container (useful for modals)
 */
export function useFocusTrap(containerRef: React.RefObject<HTMLElement>, isActive: boolean): void {
  useEffect(() => {
    if (!isActive || !containerRef.current) return;

    const container = containerRef.current;
    const focusableElements = container.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;

      if (event.shiftKey) {
        if (document.activeElement === firstElement) {
          event.preventDefault();
          lastElement?.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
          event.preventDefault();
          firstElement?.focus();
        }
      }
    };

    container.addEventListener('keydown', handleKeyDown);
    firstElement?.focus();

    return () => container.removeEventListener('keydown', handleKeyDown);
  }, [containerRef, isActive]);
}

/**
 * Hook for announcing messages to screen readers
 */
export function useAnnounce(): (message: string, priority?: 'polite' | 'assertive') => void {
  const announceRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Create the live region if it doesn't exist
    if (!document.getElementById('sr-announcer')) {
      const announcer = document.createElement('div');
      announcer.id = 'sr-announcer';
      announcer.className = 'sr-only';
      announcer.setAttribute('aria-live', 'polite');
      announcer.setAttribute('aria-atomic', 'true');
      document.body.appendChild(announcer);
      announceRef.current = announcer;
    } else {
      announceRef.current = document.getElementById('sr-announcer') as HTMLDivElement;
    }

    return () => {
      // Clean up on unmount if we created it
      const announcer = document.getElementById('sr-announcer');
      if (announcer && announceRef.current === announcer) {
        announcer.remove();
      }
    };
  }, []);

  return useCallback((message: string, priority: 'polite' | 'assertive' = 'polite') => {
    if (announceRef.current) {
      announceRef.current.setAttribute('aria-live', priority);
      announceRef.current.textContent = '';
      // Force a DOM refresh
      setTimeout(() => {
        if (announceRef.current) {
          announceRef.current.textContent = message;
        }
      }, 100);
    }
  }, []);
}

/**
 * Skip link component for keyboard navigation
 */
export const SkipLinks: React.FC = () => (
  <nav className="skip-links" aria-label="Skip navigation">
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-brand-primary focus:text-white focus:rounded-md focus:shadow-lg"
    >
      Skip to main content
    </a>
    <a
      href="#navigation"
      className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-48 focus:z-50 focus:px-4 focus:py-2 focus:bg-brand-primary focus:text-white focus:rounded-md focus:shadow-lg"
    >
      Skip to navigation
    </a>
  </nav>
);

/**
 * Live region component for dynamic announcements
 */
export const LiveRegion: React.FC<{
  message: string;
  priority?: 'polite' | 'assertive';
}> = ({ message, priority = 'polite' }) => (
  <div
    role="status"
    aria-live={priority}
    aria-atomic="true"
    className="sr-only"
  >
    {message}
  </div>
);

/**
 * Visually hidden text for screen readers
 */
export const VisuallyHidden: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="sr-only">{children}</span>
);

/**
 * Generate unique IDs for accessibility attributes
 */
let idCounter = 0;
export function generateId(prefix: string = 'a11y'): string {
  return `${prefix}-${++idCounter}`;
}

/**
 * Hook for managing focus when content changes
 */
export function useFocusOnChange(shouldFocus: boolean): React.RefObject<HTMLElement> {
  const elementRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (shouldFocus && elementRef.current) {
      elementRef.current.focus();
    }
  }, [shouldFocus]);

  return elementRef;
}

/**
 * Check if reduced motion is preferred
 */
export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Hook for detecting reduced motion preference
 */
export function usePrefersReducedMotion(): boolean {
  const mediaQuery = typeof window !== 'undefined' 
    ? window.matchMedia('(prefers-reduced-motion: reduce)') 
    : null;
  
  const getInitialState = () => mediaQuery?.matches ?? false;
  
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(getInitialState);

  useEffect(() => {
    if (!mediaQuery) return;

    const handleChange = (event: MediaQueryListEvent) => {
      setPrefersReducedMotion(event.matches);
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [mediaQuery]);

  return prefersReducedMotion;
}

/**
 * Color contrast utilities
 */
export const contrastColors = {
  // WCAG AA compliant color pairs for data visualization
  primary: {
    light: '#3b82f6', // Blue
    dark: '#93c5fd'
  },
  secondary: {
    light: '#ef4444', // Red  
    dark: '#fca5a5'
  },
  tertiary: {
    light: '#10b981', // Green
    dark: '#6ee7b7'
  },
  quaternary: {
    light: '#f97316', // Orange
    dark: '#fdba74'
  },
  quinary: {
    light: '#8b5cf6', // Purple
    dark: '#c4b5fd'
  }
};

/**
 * Get accessible color based on theme
 */
export function getAccessibleColor(
  colorKey: keyof typeof contrastColors, 
  isDarkTheme: boolean
): string {
  return isDarkTheme ? contrastColors[colorKey].dark : contrastColors[colorKey].light;
}

/**
 * AQI level descriptions for screen readers
 */
export const aqiDescriptions: Record<string, { label: string; description: string }> = {
  good: {
    label: 'Good',
    description: 'Air quality is satisfactory, and air pollution poses little or no risk.'
  },
  moderate: {
    label: 'Moderate',
    description: 'Air quality is acceptable. However, there may be a risk for some people, particularly those who are unusually sensitive to air pollution.'
  },
  unhealthySensitive: {
    label: 'Unhealthy for Sensitive Groups',
    description: 'Members of sensitive groups may experience health effects. The general public is less likely to be affected.'
  },
  unhealthy: {
    label: 'Unhealthy',
    description: 'Some members of the general public may experience health effects; members of sensitive groups may experience more serious health effects.'
  },
  veryUnhealthy: {
    label: 'Very Unhealthy',
    description: 'Health alert: The risk of health effects is increased for everyone.'
  },
  hazardous: {
    label: 'Hazardous',
    description: 'Health warning of emergency conditions: everyone is more likely to be affected.'
  }
};

/**
 * Get AQI category from numeric value
 */
export function getAqiCategory(aqi: number): keyof typeof aqiDescriptions {
  if (aqi <= 50) return 'good';
  if (aqi <= 100) return 'moderate';
  if (aqi <= 150) return 'unhealthySensitive';
  if (aqi <= 200) return 'unhealthy';
  if (aqi <= 300) return 'veryUnhealthy';
  return 'hazardous';
}

/**
 * Generate accessible label for AQI value
 */
export function getAqiAccessibleLabel(aqi: number): string {
  const category = getAqiCategory(aqi);
  const { label, description } = aqiDescriptions[category];
  return `AQI ${aqi}: ${label}. ${description}`;
}

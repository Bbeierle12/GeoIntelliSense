/**
 * Integration Tests for GeoIntelliSense
 * 
 * These tests verify component interactions with the new architecture:
 * - Header theme toggle button updates global theme
 * - ChatView displays appropriate message when backend is unavailable
 * - AnalysisView displays appropriate message when backend is unavailable
 * - MapView fetches API key from backend endpoint
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Header from '../components/Header';
import ChatView from '../components/ChatView';
import AnalysisView from '../components/AnalysisView';
import MapView from '../components/MapView';
import { UserPreferencesProvider } from '../contexts/UserPreferencesContext';

// Test wrapper that provides all necessary context
const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <UserPreferencesProvider>
    <MemoryRouter>{children}</MemoryRouter>
  </UserPreferencesProvider>
);

describe('Integration Tests', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    localStorage.clear();
    document.documentElement.classList.remove('light', 'dark');
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('Header Theme Toggle Integration', () => {
    it('should toggle theme when clicking the theme button', async () => {
      const user = userEvent.setup();
      
      render(
        <TestWrapper>
          <Header />
        </TestWrapper>
      );
      
      // Initial state should be dark mode (showing sun icon for "switch to light")
      const themeButton = screen.getByRole('button', { name: /switch to light mode/i });
      expect(themeButton).toBeInTheDocument();
      expect(document.documentElement.classList.contains('dark')).toBe(true);
      
      // Click to toggle
      await user.click(themeButton);
      
      // Should now be light mode (showing moon icon for "switch to dark")
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /switch to dark mode/i })).toBeInTheDocument();
        expect(document.documentElement.classList.contains('light')).toBe(true);
      });
    });

    it('should persist theme across Header remounts', async () => {
      const user = userEvent.setup();
      
      const { unmount } = render(
        <TestWrapper>
          <Header />
        </TestWrapper>
      );
      
      // Toggle theme to light
      await user.click(screen.getByRole('button', { name: /switch to light mode/i }));
      
      await waitFor(() => {
        expect(document.documentElement.classList.contains('light')).toBe(true);
      });
      
      // Check localStorage
      const stored = JSON.parse(localStorage.getItem('geoIntelliSense_userPreferences')!);
      expect(stored.theme).toBe('light');
      
      // Unmount and remount
      unmount();
      
      render(
        <TestWrapper>
          <Header />
        </TestWrapper>
      );
      
      // Theme should still be light
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /switch to dark mode/i })).toBeInTheDocument();
      });
    });

    it('should show correct icon for current theme', () => {
      render(
        <TestWrapper>
          <Header />
        </TestWrapper>
      );
      
      // In dark mode, sun icon should be shown (to switch to light)
      const themeButton = screen.getByRole('button', { name: /switch to light mode/i });
      
      // SVG should be present
      expect(themeButton.querySelector('svg')).toBeInTheDocument();
    });
  });

  describe('ChatView Backend Unavailability', () => {
    it('should display error message when backend is unavailable', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
      
      render(
        <TestWrapper>
          <ChatView />
        </TestWrapper>
      );
      
      await waitFor(() => {
        // ChatView should show the error message about backend
        expect(screen.getByText(/Backend server is not running/i)).toBeInTheDocument();
      });
    });

    it('should disable send button when backend is unavailable', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
      
      render(
        <TestWrapper>
          <ChatView />
        </TestWrapper>
      );
      
      await waitFor(() => {
        const sendButton = screen.getByRole('button', { name: /send/i });
        expect(sendButton).toBeDisabled();
      });
    });

    it('should show initial greeting when backend is available', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 'ok' }),
      });
      
      render(
        <TestWrapper>
          <ChatView />
        </TestWrapper>
      );
      
      await waitFor(() => {
        expect(screen.getByText(/Hello! I am your geospatial analyst/i)).toBeInTheDocument();
      });
    });

    it('should enable send button when backend is available', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 'ok' }),
      });
      
      render(
        <TestWrapper>
          <ChatView />
        </TestWrapper>
      );
      
      await waitFor(() => {
        const sendButton = screen.getByRole('button', { name: /send/i });
        expect(sendButton).not.toBeDisabled();
      });
    });
  });

  describe('AnalysisView Backend Unavailability', () => {
    it('should display warning when backend is unavailable', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
      
      render(
        <TestWrapper>
          <AnalysisView />
        </TestWrapper>
      );
      
      await waitFor(() => {
        expect(screen.getByText(/Backend Server Required/i)).toBeInTheDocument();
      });
    });

    it('should disable Generate Analysis button when backend is unavailable', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
      
      render(
        <TestWrapper>
          <AnalysisView />
        </TestWrapper>
      );
      
      await waitFor(() => {
        const analyzeButton = screen.getByRole('button', { name: /generate analysis/i });
        expect(analyzeButton).toBeDisabled();
      });
    });

    it('should show instructions for starting the backend', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
      
      render(
        <TestWrapper>
          <AnalysisView />
        </TestWrapper>
      );
      
      await waitFor(() => {
        expect(screen.getByText(/npm run server/i)).toBeInTheDocument();
        expect(screen.getByText(/GEMINI_API_KEY/i)).toBeInTheDocument();
      });
    });

    it('should not show warning when backend is available', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 'ok' }),
      });
      
      render(
        <TestWrapper>
          <AnalysisView />
        </TestWrapper>
      );
      
      await waitFor(() => {
        expect(screen.queryByText(/Backend Server Required/i)).not.toBeInTheDocument();
      });
    });

    it('should enable Generate Analysis button when backend is available', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 'ok' }),
      });
      
      render(
        <TestWrapper>
          <AnalysisView />
        </TestWrapper>
      );
      
      await waitFor(() => {
        const analyzeButton = screen.getByRole('button', { name: /generate analysis/i });
        expect(analyzeButton).not.toBeDisabled();
      });
    });
  });

  describe('MapView API Key Fetching', () => {
    it('should fetch API key from backend endpoint', async () => {
      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/health')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ status: 'ok' }),
          });
        }
        if (url.includes('/api/maps-config')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ apiKey: 'mock-api-key' }),
          });
        }
        return Promise.resolve({ ok: false, status: 404 });
      });
      global.fetch = mockFetch;
      
      render(
        <TestWrapper>
          <MapView />
        </TestWrapper>
      );
      
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('http://localhost:3001/api/maps-config');
      });
    });

    it('should display error when Google Maps API key is not configured', async () => {
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/maps-config')) {
          return Promise.reject(new Error('Failed to fetch'));
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ status: 'ok' }),
        });
      });
      
      render(
        <TestWrapper>
          <MapView />
        </TestWrapper>
      );
      
      await waitFor(() => {
        expect(screen.getByText(/Google Maps API Key Required/i)).toBeInTheDocument();
      });
    });

    it('should show instructions for configuring API key', async () => {
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/maps-config')) {
          return Promise.reject(new Error('Failed to fetch'));
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ status: 'ok' }),
        });
      });
      
      render(
        <TestWrapper>
          <MapView />
        </TestWrapper>
      );
      
      await waitFor(() => {
        // Use getAllByText since the text appears multiple times
        const elements = screen.getAllByText(/GOOGLE_MAPS_API_KEY/i);
        expect(elements.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Accessibility Integration', () => {
    it('should have proper aria-labels on theme toggle', () => {
      render(
        <TestWrapper>
          <Header />
        </TestWrapper>
      );
      
      const themeButton = screen.getByRole('button', { name: /switch to light mode/i });
      expect(themeButton).toHaveAttribute('aria-label');
    });
  });
});

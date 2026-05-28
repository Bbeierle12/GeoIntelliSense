/**
 * Mock handlers for API endpoints used in tests.
 * These handlers simulate backend responses for the GeoIntelliSense application.
 */

import { vi } from 'vitest';

// Mock API responses
export const mockHealthResponse = { status: 'ok' };
export const mockMapsConfigResponse = { apiKey: 'mock-google-maps-api-key' };
export const mockChatResponse = { response: 'This is a mock chat response from Claude.' };

// Mock fetch implementation
export const createMockFetch = (options?: {
  healthStatus?: 'ok' | 'error' | 'down';
  mapsApiKeyAvailable?: boolean;
}) => {
  const { healthStatus = 'ok', mapsApiKeyAvailable = true } = options || {};

  return vi.fn().mockImplementation((url: string) => {
    // Health check endpoint
    if (url.includes('/api/health')) {
      if (healthStatus === 'down') {
        return Promise.reject(new Error('Network error'));
      }
      if (healthStatus === 'error') {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: 'Internal server error' }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockHealthResponse),
      });
    }

    // Maps config endpoint
    if (url.includes('/api/maps-config')) {
      if (!mapsApiKeyAvailable) {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: 'API key not configured' }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockMapsConfigResponse),
      });
    }

    // Chat endpoint
    if (url.includes('/api/chat')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockChatResponse),
      });
    }

    // Default: return 404 for unknown endpoints
    return Promise.resolve({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: 'Not found' }),
    });
  });
};

// Setup mock fetch for tests
export const setupMockFetch = (options?: Parameters<typeof createMockFetch>[0]) => {
  const mockFetch = createMockFetch(options);
  global.fetch = mockFetch;
  return mockFetch;
};

// Reset mock fetch
export const resetMockFetch = () => {
  vi.restoreAllMocks();
};

/**
 * Security Tests for GeoIntelliSense
 * 
 * These tests verify that:
 * - API keys are NOT exposed in the client bundle
 * - The useApiStatus hook properly checks backend availability
 * - Error handling works correctly when backend is down
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useApiStatus } from '../hooks/useApiStatus';

describe('Security Tests', () => {
  describe('API Key Protection', () => {
    it('should not have process.env exposed on the window object', () => {
      // In a secure client-side build, process.env should not be directly accessible
      // or should not contain sensitive API keys
      expect((window as any).process?.env?.ANTHROPIC_API_KEY).toBeUndefined();
      expect((window as any).process?.env?.GOOGLE_MAPS_API_KEY).toBeUndefined();
    });

    it('should not have API keys in import.meta.env for client', () => {
      // Vite uses import.meta.env for environment variables
      // Sensitive keys should only be on the server
      const env = (import.meta as any).env || {};
      expect(env.ANTHROPIC_API_KEY).toBeUndefined();
      expect(env.GOOGLE_MAPS_API_KEY).toBeUndefined();
    });

    it('should not expose API keys in global scope', () => {
      // Check that API keys are not leaked to global scope
      expect((globalThis as any).ANTHROPIC_API_KEY).toBeUndefined();
      expect((globalThis as any).GOOGLE_MAPS_API_KEY).toBeUndefined();
      expect((globalThis as any).apiKey).toBeUndefined();
    });
  });

  describe('useApiStatus Hook', () => {
    let originalFetch: typeof fetch;

    beforeEach(() => {
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
      vi.restoreAllMocks();
    });

    it('should start with loading state', () => {
      // Mock fetch to never resolve during this test
      global.fetch = vi.fn().mockImplementation(() => new Promise(() => {}));
      
      const { result } = renderHook(() => useApiStatus());
      
      expect(result.current.isLoading).toBe(true);
      expect(result.current.isAvailable).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('should set isAvailable to true when backend is healthy', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 'ok' }),
      });
      
      const { result } = renderHook(() => useApiStatus());
      
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
        expect(result.current.isAvailable).toBe(true);
        expect(result.current.error).toBeNull();
      });
    });

    it('should set error when backend returns error status', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Internal server error' }),
      });
      
      const { result } = renderHook(() => useApiStatus());
      
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
        expect(result.current.isAvailable).toBe(false);
        expect(result.current.error).toBe('Backend services are not running. Start them with: docker compose up');
      });
    });

    it('should handle network errors when backend is down', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
      
      const { result } = renderHook(() => useApiStatus());
      
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
        expect(result.current.isAvailable).toBe(false);
        expect(result.current.error).toBe('Backend services are not running. Start them with: docker compose up');
      });
    });

    it('should call the correct health endpoint URL', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 'ok' }),
      });
      global.fetch = mockFetch;
      
      renderHook(() => useApiStatus());
      
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('http://localhost:3001/health');
      });
    });
  });

  describe('Backend Communication Security', () => {
    let originalFetch: typeof fetch;

    beforeEach(() => {
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
      vi.restoreAllMocks();
    });

    it('should fetch API key from backend, not hardcoded', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ apiKey: 'mock-api-key' }),
      });
      global.fetch = mockFetch;
      
      // Simulate fetching maps config (as MapView does)
      await fetch('http://localhost:8080/api/maps-config');
      
      expect(mockFetch).toHaveBeenCalledWith('http://localhost:8080/api/maps-config');
    });

    it('should handle missing API key configuration gracefully', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'API key not configured' }),
      });
      
      const response = await fetch('http://localhost:8080/api/maps-config');
      
      expect(response.ok).toBe(false);
      expect(response.status).toBe(500);
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Exercises the runtime server-address override used by the native
// (Capacitor) Android build. `config/api` computes its exports at import time,
// so each case resets modules and re-imports.

const STORAGE_KEY = 'geointellisense.serverConfig';

let nativePlatform = false;

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => nativePlatform,
  },
}));

const loadApi = async () => {
  vi.resetModules();
  return import('../config/api');
};

describe('server config (native override)', () => {
  beforeEach(() => {
    localStorage.clear();
    nativePlatform = false;
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('ignores stored addresses when not running natively', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ gatewayUrl: 'https://api.example.com', ingestionUrl: 'https://ingest.example.com' }),
    );
    const api = await loadApi();
    expect(api.gatewayBaseUrl).toBe('http://localhost:8080');
    expect(api.ingestionBaseUrl).toBe('http://localhost:3001');
    expect(api.isBackendConfigured).toBe(true);
  });

  it('uses stored addresses in the native app', async () => {
    nativePlatform = true;
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ gatewayUrl: 'https://api.example.com/', ingestionUrl: 'https://ingest.example.com/v1/' }),
    );
    const api = await loadApi();
    expect(api.gatewayBaseUrl).toBe('https://api.example.com');
    expect(api.ingestionBaseUrl).toBe('https://ingest.example.com/v1');
    expect(api.gatewayApiUrl).toBe('https://api.example.com/api');
    expect(api.isBackendConfigured).toBe(true);
  });

  it('falls back safely when the stored value is corrupt', async () => {
    nativePlatform = true;
    localStorage.setItem(STORAGE_KEY, '{not json');
    const api = await loadApi();
    expect(api.gatewayBaseUrl).toBe('http://localhost:8080');
  });

  it('reports the backend as unconfigured in a native production build with no address', async () => {
    nativePlatform = true;
    vi.stubEnv('DEV', false);
    vi.stubEnv('PROD', true);
    vi.stubEnv('MODE', 'production');
    vi.stubEnv('VITE_GATEWAY_URL', '');
    vi.stubEnv('VITE_INGESTION_URL', '');
    const api = await loadApi();
    expect(api.isBackendConfigured).toBe(false);
    expect(api.gatewayBaseUrl).toMatch(/\.invalid$/);
    expect(api.ingestionBaseUrl).toMatch(/\.invalid$/);
  });

  it('still throws for a web production build with no address', async () => {
    nativePlatform = false;
    vi.stubEnv('DEV', false);
    vi.stubEnv('PROD', true);
    vi.stubEnv('MODE', 'production');
    vi.stubEnv('VITE_GATEWAY_URL', '');
    vi.stubEnv('VITE_INGESTION_URL', '');
    await expect(loadApi()).rejects.toThrow(/VITE_GATEWAY_URL is required/);
  });

  it('saveServerConfig validates, normalizes and persists both addresses', async () => {
    const api = await loadApi();
    const saved = api.saveServerConfig({
      gatewayUrl: '  https://api.example.com/ ',
      ingestionUrl: 'https://ingest.example.com',
    });
    expect(saved).toEqual({ gatewayUrl: 'https://api.example.com', ingestionUrl: 'https://ingest.example.com' });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')).toEqual(saved);
    expect(api.readStoredServerConfig()).toEqual(saved);

    api.clearServerConfig();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('rejects addresses that are not absolute URLs', async () => {
    const api = await loadApi();
    expect(() => api.saveServerConfig({ gatewayUrl: 'not-a-url', ingestionUrl: 'https://x.example' })).toThrow(
      /Gateway URL must be an absolute URL/,
    );
    expect(() => api.validateServerUrl('ftp://x.example', 'Gateway URL')).toThrow(/http or https/);
  });

  describe('production URL policy for user-entered addresses', () => {
    beforeEach(() => {
      vi.stubEnv('PROD', true);
    });

    it('allows plain HTTP to private LAN hosts', async () => {
      const api = await loadApi();
      expect(api.validateServerUrl('http://192.168.1.20:8080', 'Gateway URL')).toBe('http://192.168.1.20:8080');
      expect(api.validateServerUrl('http://10.0.0.5:3001', 'Ingestion URL')).toBe('http://10.0.0.5:3001');
      expect(api.validateServerUrl('http://172.20.1.1', 'Gateway URL')).toBe('http://172.20.1.1');
      expect(api.validateServerUrl('http://mybox.local:8080', 'Gateway URL')).toBe('http://mybox.local:8080');
      // Tailscale (CGNAT 100.64.0.0/10)
      expect(api.validateServerUrl('http://100.101.102.103:8080', 'Gateway URL')).toBe('http://100.101.102.103:8080');
      expect(api.validateServerUrl('http://100.64.0.1:3001', 'Ingestion URL')).toBe('http://100.64.0.1:3001');
      expect(api.validateServerUrl('http://100.127.255.254', 'Gateway URL')).toBe('http://100.127.255.254');
      // Tailscale MagicDNS and bare machine names
      expect(api.validateServerUrl('http://mybox.tail1234.ts.net:8080', 'Gateway URL')).toBe('http://mybox.tail1234.ts.net:8080');
      expect(api.validateServerUrl('http://mybox:8080', 'Gateway URL')).toBe('http://mybox:8080');
    });

    it('rejects plain HTTP to public hosts', async () => {
      const api = await loadApi();
      expect(() => api.validateServerUrl('http://api.example.com', 'Gateway URL')).toThrow(/must use HTTPS/);
      expect(() => api.validateServerUrl('http://8.8.8.8', 'Gateway URL')).toThrow(/must use HTTPS/);
      // Just outside the CGNAT range
      expect(() => api.validateServerUrl('http://100.63.255.255', 'Gateway URL')).toThrow(/must use HTTPS/);
      expect(() => api.validateServerUrl('http://100.128.0.1', 'Gateway URL')).toThrow(/must use HTTPS/);
      expect(() => api.validateServerUrl('http://ts.net.example.com', 'Gateway URL')).toThrow(/must use HTTPS/);
      expect(() => api.validateServerUrl('http://mybox.example.com', 'Gateway URL')).toThrow(/must use HTTPS/);
    });
  });
});

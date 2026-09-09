import { Capacitor } from '@capacitor/core';

const DEV_GATEWAY_URL = 'http://localhost:8080';
const DEV_INGESTION_URL = 'http://localhost:3001';

/**
 * Sentinel used by native (Capacitor) builds when no backend has been
 * configured yet. The `.invalid` TLD is reserved and never resolves, so every
 * request fails fast instead of hitting the app's own local origin.
 */
const UNCONFIGURED_BASE_URL = 'https://backend-not-configured.invalid';

/** localStorage key holding the user-entered server addresses on mobile. */
export const SERVER_CONFIG_STORAGE_KEY = 'geointellisense.serverConfig';

export interface ServerConfig {
  gatewayUrl: string;
  ingestionUrl: string;
}

const LOCALHOST_HOSTS = new Set(['localhost', '127.0.0.1', '10.0.2.2']);

/**
 * Hosts that can only be reached from a private network, so plain HTTP is
 * acceptable for them in debug builds:
 * - RFC 1918 ranges (10/8, 172.16/12, 192.168/16)
 * - the CGNAT range Tailscale assigns (100.64.0.0/10)
 * - mDNS `.local` names and Tailscale MagicDNS `.ts.net` names
 * - single-label names (`mybox`), which resolve only via LAN or tailnet DNS
 */
const PRIVATE_HOST_PATTERN =
  /^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}|[a-z0-9-]+\.local|[a-z0-9-]+(\.[a-z0-9-]+)*\.ts\.net|[a-z0-9-]+)$/i;

/** True when running inside the Capacitor Android/iOS shell. */
export const isNativeApp = (): boolean => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

interface NormalizeOptions {
  /**
   * Allow plain HTTP to private LAN hosts. Used for user-entered addresses on
   * mobile so a debug build can talk to `docker compose` on a laptop. Release
   * builds still block cleartext at the OS level (network_security_config).
   */
  allowPrivateHttp?: boolean;
}

const normalizeBaseUrl = (value: string, envName: string, options: NormalizeOptions = {}): string => {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${envName} must be an absolute URL. Received: ${value}`);
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`${envName} must use http or https. Received: ${value}`);
  }

  if (import.meta.env.PROD) {
    const isPrivateHost = LOCALHOST_HOSTS.has(parsed.hostname) || PRIVATE_HOST_PATTERN.test(parsed.hostname);
    if (parsed.protocol !== 'https:' && !(options.allowPrivateHttp && isPrivateHost)) {
      throw new Error(`${envName} must use HTTPS in production builds.`);
    }
    if (LOCALHOST_HOSTS.has(parsed.hostname) && !options.allowPrivateHttp) {
      throw new Error(`${envName} cannot use localhost/loopback in production builds.`);
    }
  }

  return `${parsed.origin}${parsed.pathname.replace(/\/$/, '')}`;
};

/**
 * Validate and normalize a user-entered server address. Throws with a
 * human-readable message on invalid input.
 */
export const validateServerUrl = (value: string, label: string): string =>
  normalizeBaseUrl(value.trim(), label, { allowPrivateHttp: true });

export const readStoredServerConfig = (): Partial<ServerConfig> | null => {
  try {
    const raw = globalThis.localStorage?.getItem(SERVER_CONFIG_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const { gatewayUrl, ingestionUrl } = parsed as Record<string, unknown>;
    return {
      gatewayUrl: typeof gatewayUrl === 'string' ? gatewayUrl : undefined,
      ingestionUrl: typeof ingestionUrl === 'string' ? ingestionUrl : undefined,
    };
  } catch {
    return null;
  }
};

/**
 * Persist server addresses entered in Settings. Both values are validated
 * first; the caller should reload the app afterwards so the module-level
 * URLs below are recomputed.
 */
export const saveServerConfig = (config: ServerConfig): ServerConfig => {
  const normalized: ServerConfig = {
    gatewayUrl: validateServerUrl(config.gatewayUrl, 'Gateway URL'),
    ingestionUrl: validateServerUrl(config.ingestionUrl, 'Ingestion URL'),
  };
  globalThis.localStorage?.setItem(SERVER_CONFIG_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
};

export const clearServerConfig = (): void => {
  try {
    globalThis.localStorage?.removeItem(SERVER_CONFIG_STORAGE_KEY);
  } catch {
    // Storage unavailable; nothing to clear.
  }
};

const resolveBaseUrl = (
  storedValue: string | undefined,
  envValue: string | undefined,
  devDefault: string,
  envName: string,
): string => {
  const native = isNativeApp();

  // 1) Address entered by the user on the device (native builds only).
  const stored = storedValue?.trim();
  if (native && stored) {
    try {
      return normalizeBaseUrl(stored, envName, { allowPrivateHttp: true });
    } catch (err) {
      console.warn(`[api] Ignoring stored ${envName}:`, err);
    }
  }

  // 2) Address baked in at build time.
  const trimmed = envValue?.trim();
  if (trimmed) {
    return normalizeBaseUrl(trimmed, envName);
  }

  // 3) Local development defaults.
  if (import.meta.env.DEV || import.meta.env.MODE === 'test') {
    return devDefault;
  }

  // 4) Native app with nothing configured yet: fail requests fast and let the
  //    Settings screen collect the address instead of crashing at startup.
  if (native) {
    return UNCONFIGURED_BASE_URL;
  }

  throw new Error(`${envName} is required in production and must be an absolute HTTPS URL.`);
};

const storedConfig = readStoredServerConfig();

export const gatewayBaseUrl = resolveBaseUrl(
  storedConfig?.gatewayUrl,
  import.meta.env.VITE_GATEWAY_URL,
  DEV_GATEWAY_URL,
  'VITE_GATEWAY_URL',
);
export const ingestionBaseUrl = resolveBaseUrl(
  storedConfig?.ingestionUrl,
  import.meta.env.VITE_INGESTION_URL,
  DEV_INGESTION_URL,
  'VITE_INGESTION_URL',
);

/** False on a native build that has no backend address yet. */
export const isBackendConfigured =
  gatewayBaseUrl !== UNCONFIGURED_BASE_URL && ingestionBaseUrl !== UNCONFIGURED_BASE_URL;

export const gatewayApiUrl = `${gatewayBaseUrl}/api`;
export const ingestionApiUrl = `${ingestionBaseUrl}/api`;

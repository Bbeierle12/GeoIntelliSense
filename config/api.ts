const DEV_GATEWAY_URL = 'http://localhost:8080';
const DEV_INGESTION_URL = 'http://localhost:3001';

const LOCALHOST_HOSTS = new Set(['localhost', '127.0.0.1', '10.0.2.2']);

const normalizeBaseUrl = (value: string, envName: string): string => {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${envName} must be an absolute URL. Received: ${value}`);
  }

  if (import.meta.env.PROD) {
    if (parsed.protocol !== 'https:') {
      throw new Error(`${envName} must use HTTPS in production builds.`);
    }
    if (LOCALHOST_HOSTS.has(parsed.hostname)) {
      throw new Error(`${envName} cannot use localhost/loopback in production builds.`);
    }
  }

  return `${parsed.origin}${parsed.pathname.replace(/\/$/, '')}`;
};

const resolveBaseUrl = (value: string | undefined, devDefault: string, envName: string): string => {
  const trimmed = value?.trim();
  if (trimmed) {
    return normalizeBaseUrl(trimmed, envName);
  }

  if (import.meta.env.DEV || import.meta.env.MODE === 'test') {
    return devDefault;
  }

  throw new Error(`${envName} is required in production and must be an absolute HTTPS URL.`);
};

export const gatewayBaseUrl = resolveBaseUrl(import.meta.env.VITE_GATEWAY_URL, DEV_GATEWAY_URL, 'VITE_GATEWAY_URL');
export const ingestionBaseUrl = resolveBaseUrl(import.meta.env.VITE_INGESTION_URL, DEV_INGESTION_URL, 'VITE_INGESTION_URL');

export const gatewayApiUrl = `${gatewayBaseUrl}/api`;
export const ingestionApiUrl = `${ingestionBaseUrl}/api`;

import { describe, expect, it } from 'vitest';
import { gatewayApiUrl, gatewayBaseUrl, ingestionApiUrl, ingestionBaseUrl } from '../config/api';

describe('API config defaults', () => {
  it('uses localhost defaults in test/dev mode', () => {
    expect(gatewayBaseUrl).toBe('http://localhost:8080');
    expect(ingestionBaseUrl).toBe('http://localhost:3001');
    expect(gatewayApiUrl).toBe('http://localhost:8080/api');
    expect(ingestionApiUrl).toBe('http://localhost:3001/api');
  });
});

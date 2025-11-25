import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { 
  DataServiceError, 
  ErrorCode, 
  isRetryable, 
  toDataServiceError,
  withRetry,
  fetchWithTimeout,
  safeJsonParse,
  logError
} from '../utils/errorHandling';

describe('Error Handling Utils', () => {
  describe('DataServiceError', () => {
    it('creates error with correct properties', () => {
      const error = new DataServiceError(
        'Test error',
        ErrorCode.NETWORK_ERROR,
        true,
        { extra: 'data' }
      );

      expect(error.message).toBe('Test error');
      expect(error.code).toBe(ErrorCode.NETWORK_ERROR);
      expect(error.retryable).toBe(true);
      expect(error.details).toEqual({ extra: 'data' });
      expect(error.name).toBe('DataServiceError');
      expect(error.timestamp).toBeInstanceOf(Date);
    });

    it('getUserMessage returns user-friendly messages', () => {
      const networkError = new DataServiceError('', ErrorCode.NETWORK_ERROR);
      expect(networkError.getUserMessage()).toBe('Unable to connect. Please check your internet connection.');

      const rateLimitError = new DataServiceError('', ErrorCode.RATE_LIMIT_EXCEEDED);
      expect(rateLimitError.getUserMessage()).toBe('Too many requests. Please wait a moment and try again.');

      const serverError = new DataServiceError('', ErrorCode.SERVER_ERROR);
      expect(serverError.getUserMessage()).toBe('Server error. Our team has been notified.');

      const timeoutError = new DataServiceError('', ErrorCode.TIMEOUT);
      expect(timeoutError.getUserMessage()).toBe('Request timed out. Please try again.');

      const notFoundError = new DataServiceError('', ErrorCode.DATA_NOT_FOUND);
      expect(notFoundError.getUserMessage()).toBe('The requested data is not available.');

      const unknownError = new DataServiceError('', ErrorCode.UNKNOWN_ERROR);
      expect(unknownError.getUserMessage()).toBe('An unexpected error occurred. Please try again.');
    });

    it('toJSON serializes error correctly', () => {
      const error = new DataServiceError(
        'Test error',
        ErrorCode.API_KEY_INVALID,
        false
      );

      const json = error.toJSON();
      expect(json).toHaveProperty('name', 'DataServiceError');
      expect(json).toHaveProperty('message', 'Test error');
      expect(json).toHaveProperty('code', ErrorCode.API_KEY_INVALID);
      expect(json).toHaveProperty('retryable', false);
      expect(json).toHaveProperty('timestamp');
    });
  });

  describe('isRetryable', () => {
    it('returns true for retryable DataServiceError', () => {
      const error = new DataServiceError('', ErrorCode.NETWORK_ERROR, true);
      expect(isRetryable(error)).toBe(true);
    });

    it('returns false for non-retryable DataServiceError', () => {
      const error = new DataServiceError('', ErrorCode.API_KEY_INVALID, false);
      expect(isRetryable(error)).toBe(false);
    });

    it('returns true for network TypeError', () => {
      const error = new TypeError('Failed to fetch');
      expect(isRetryable(error)).toBe(true);
    });

    it('returns false for other errors', () => {
      const error = new Error('Some error');
      expect(isRetryable(error)).toBe(false);
    });
  });

  describe('toDataServiceError', () => {
    it('returns same error if already DataServiceError', () => {
      const original = new DataServiceError('Test', ErrorCode.NETWORK_ERROR);
      const result = toDataServiceError(original);
      expect(result).toBe(original);
    });

    it('converts network errors', () => {
      const error = new Error('Failed to fetch');
      const result = toDataServiceError(error);
      expect(result.code).toBe(ErrorCode.NETWORK_ERROR);
      expect(result.retryable).toBe(true);
    });

    it('converts timeout errors', () => {
      const error = new Error('Request timeout');
      const result = toDataServiceError(error);
      expect(result.code).toBe(ErrorCode.TIMEOUT);
      expect(result.retryable).toBe(true);
    });

    it('converts 401/403 errors', () => {
      const error = new Error('401 Unauthorized');
      const result = toDataServiceError(error);
      expect(result.code).toBe(ErrorCode.API_KEY_INVALID);
      expect(result.retryable).toBe(false);
    });

    it('converts 429 rate limit errors', () => {
      const error = new Error('429 Too Many Requests');
      const result = toDataServiceError(error);
      expect(result.code).toBe(ErrorCode.RATE_LIMIT_EXCEEDED);
      expect(result.retryable).toBe(true);
    });

    it('converts 404 errors', () => {
      const error = new Error('404 Not Found');
      const result = toDataServiceError(error);
      expect(result.code).toBe(ErrorCode.DATA_NOT_FOUND);
      expect(result.retryable).toBe(false);
    });

    it('converts 500 errors', () => {
      const error = new Error('500 Internal Server Error');
      const result = toDataServiceError(error);
      expect(result.code).toBe(ErrorCode.SERVER_ERROR);
      expect(result.retryable).toBe(true);
    });

    it('converts unknown errors', () => {
      const error = new Error('Something weird');
      const result = toDataServiceError(error);
      expect(result.code).toBe(ErrorCode.UNKNOWN_ERROR);
    });

    it('handles non-Error objects', () => {
      const result = toDataServiceError('string error');
      expect(result.code).toBe(ErrorCode.UNKNOWN_ERROR);
    });
  });

  describe('withRetry', () => {
    it('returns result on success', async () => {
      const fn = vi.fn().mockResolvedValue('success');
      
      const result = await withRetry(fn);
      
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('retries on retryable error', async () => {
      const retryableError = new DataServiceError('', ErrorCode.NETWORK_ERROR, true);
      const fn = vi.fn()
        .mockRejectedValueOnce(retryableError)
        .mockResolvedValueOnce('success');
      
      const result = await withRetry(fn, { maxRetries: 3, initialDelay: 1 });
      
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('does not retry on non-retryable error', async () => {
      const nonRetryableError = new DataServiceError('', ErrorCode.API_KEY_INVALID, false);
      const fn = vi.fn().mockRejectedValue(nonRetryableError);
      
      await expect(withRetry(fn)).rejects.toThrow();
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('stops after maxRetries', async () => {
      const retryableError = new DataServiceError('', ErrorCode.NETWORK_ERROR, true);
      const fn = vi.fn().mockRejectedValue(retryableError);
      
      await expect(withRetry(fn, { maxRetries: 2, initialDelay: 1 })).rejects.toThrow();
      expect(fn).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });

    it('calls onRetry callback', async () => {
      const retryableError = new DataServiceError('', ErrorCode.NETWORK_ERROR, true);
      const fn = vi.fn()
        .mockRejectedValueOnce(retryableError)
        .mockResolvedValueOnce('success');
      const onRetry = vi.fn();
      
      await withRetry(fn, { maxRetries: 3, onRetry, initialDelay: 1 });
      
      expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error), expect.any(Number));
    });
  });

  describe('fetchWithTimeout', () => {
    it('returns response on success', async () => {
      const mockResponse = new Response('ok');
      global.fetch = vi.fn().mockResolvedValue(mockResponse);
      
      const result = await fetchWithTimeout('/api/test');
      
      expect(result).toBe(mockResponse);
    });

    it('passes abort signal to fetch', async () => {
      const mockResponse = new Response('ok');
      global.fetch = vi.fn().mockResolvedValue(mockResponse);
      
      await fetchWithTimeout('/api/test', { timeout: 5000 });
      
      expect(global.fetch).toHaveBeenCalledWith('/api/test', expect.objectContaining({
        signal: expect.any(AbortSignal)
      }));
    });
  });

  describe('safeJsonParse', () => {
    it('parses valid JSON', () => {
      const result = safeJsonParse('{"key": "value"}');
      expect(result).toEqual({ key: 'value' });
    });

    it('returns fallback on invalid JSON', () => {
      const result = safeJsonParse('invalid', { default: true });
      expect(result).toEqual({ default: true });
    });

    it('throws DataServiceError when no fallback provided', () => {
      expect(() => safeJsonParse('invalid')).toThrow(DataServiceError);
    });
  });

  describe('logError', () => {
    beforeEach(() => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('logs DataServiceError with toJSON', () => {
      const error = new DataServiceError('Test', ErrorCode.NETWORK_ERROR);
      logError(error, 'TestContext');
      
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('[TestContext]'),
        expect.objectContaining({ code: ErrorCode.NETWORK_ERROR })
      );
    });

    it('logs regular Error with stack', () => {
      const error = new Error('Regular error');
      logError(error);
      
      expect(console.error).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ name: 'Error', message: 'Regular error' })
      );
    });

    it('logs unknown error types', () => {
      logError('string error');
      
      expect(console.error).toHaveBeenCalledWith(
        expect.any(String),
        'string error'
      );
    });
  });
});
